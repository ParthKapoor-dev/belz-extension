// Direct client for the Automation Designer REST API.
//
// The AD Network panel needs two things the raw network log cannot give it:
// the human-readable name/category behind an `execute` uuid, and the
// designer URL to open that method in. Both come from the chain definition
// endpoint on the inspected host itself — the same endpoint the page's own
// designer calls.
//
// Auth, in order of preference:
//
//   1. The Authorization header lifted off a real chain request we already
//      observed in DevTools. This is exact: whatever the app sends, we send.
//   2. A JWT found in the page's localStorage/sessionStorage. Generic scan —
//      no storage key names are assumed.
//   3. Cookies alone (`credentials: 'include'`). Works on cookie-session
//      deployments. Requires the host grant from the options page, which the
//      panel already depends on to exist.
//
// Results are memoised through cache.ts, so a repeat visit resolves names
// with no network at all.

import { chainV1Path, chainV2Path, designerPath } from '../../config/endpoints';
import { getApiOrigin, getDesignerOrigin } from './origin';
import { read as cacheRead, write as cacheWrite } from './cache';
import { firstString } from './extract';
import { evalInPage } from '../inspected';
import type { MethodSummary } from './types';

/** Header names worth replaying, lowercased. */
const AUTH_HEADERS = ['authorization', 'expertly-auth-token'];

/** Scans page storage for a JWT without assuming any key name. */
const TOKEN_SCAN = `(function () {
  try {
    var stores = [window.localStorage, window.sessionStorage];
    for (var s = 0; s < stores.length; s++) {
      var st = stores[s];
      if (!st) continue;
      for (var i = 0; i < st.length; i++) {
        var v = st.getItem(st.key(i));
        if (typeof v !== 'string') continue;
        var m = v.match(/eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]+/);
        if (m) return m[0];
      }
    }
  } catch (e) {}
  return null;
})()`;

/** A failed API call: an HTTP error (`status`) or an unreachable host (`transport`). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly transport = false
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Headers = Record<string, string>;

/** Headers harvested from an observed request. */
let harvested: Headers | null = null;
let scannedToken: string | null = null;
let scanTried = false;

/** In-flight resolves, so a burst of rows for one uuid makes one request. */
const inFlight = new Map<string, Promise<MethodSummary | null>>();

/**
 * Lift auth headers off an observed AD chain request. Called for every entry
 * the panel captures; the last one wins so a refreshed token replaces a
 * stale one.
 */
export function rememberAuth(
  har: { request?: { headers?: ReadonlyArray<{ name: string; value: string }> } } | null | undefined
): void {
  const headers = har?.request?.headers;
  if (!Array.isArray(headers)) return;
  const found: Headers = {};
  for (const h of headers) {
    if (!h || typeof h.name !== 'string' || typeof h.value !== 'string') continue;
    if (AUTH_HEADERS.includes(h.name.toLowerCase()) && h.value) found[h.name] = h.value;
  }
  if (Object.keys(found).length) harvested = found;
}

async function scanPageToken(): Promise<string | null> {
  if (scanTried) return scannedToken;
  scanTried = true;
  const result = await evalInPage(TOKEN_SCAN);
  scannedToken = typeof result === 'string' && result ? result : null;
  return scannedToken;
}

async function authHeaders(): Promise<Headers> {
  if (harvested) return { ...harvested };
  const token = await scanPageToken();
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json | null =>
  value && typeof value === 'object' ? (value as Json) : null;

/** Normalise a V2 chain document down to the fields the panel needs. */
function summaryFromV2(raw: unknown): MethodSummary | null {
  const doc = asObject(raw);
  if (!doc) return null;
  const metadata = asObject(doc.metadata) || {};
  const service = asObject(metadata.service) || {};
  const name = firstString(doc.name, doc.aliasName, metadata.name);
  const category = firstString(service.name, metadata.categoryName);
  if (!name && !category) return null;
  return {
    name,
    category,
    state: firstString(metadata.state) || 'DRAFT',
    referenceId: firstString(metadata.referenceId)
  };
}

/** Normalise a V1 chain document. The body lives inside `jsonDefinition`. */
function summaryFromV1(raw: unknown): MethodSummary | null {
  const doc = asObject(raw);
  if (!doc) return null;
  let def: unknown = doc.jsonDefinition;
  if (typeof def === 'string') {
    try {
      def = JSON.parse(def);
    } catch {
      def = null;
    }
  }
  const definition = asObject(def);
  const name = firstString(definition?.name, definition?.methodName, doc.aliasName, doc.name);
  const category = firstString(asObject(doc.category)?.name);
  if (!name && !category) return null;
  return {
    name,
    category,
    state: firstString(doc.automationState) || 'DRAFT',
    referenceId: firstString(doc.referenceId)
  };
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function getJson(path: string, headers: Headers): Promise<unknown> {
  const origin = getApiOrigin();
  if (!origin) {
    throw new ApiError('inspected origin unknown — reopen DevTools on the page');
  }

  let res: Response;
  try {
    res = await fetch(origin + path, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*', ...headers }
    });
  } catch (err) {
    // A TypeError here is almost always a missing host grant: without one the
    // browser blocks the extension's cross-origin request outright. Say so,
    // because "Failed to fetch" on its own sends people hunting the network.
    throw new ApiError(
      `cannot reach ${new URL(origin).host} — add it on the extension's ` +
        `options page (${errorText(err) || 'network error'})`,
      undefined,
      true
    );
  }

  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status} on ${path.split('?')[0]}`, res.status);
  }

  try {
    return await res.json();
  } catch {
    throw new ApiError(`non-JSON response from ${path.split('?')[0]}`);
  }
}

/**
 * Fetch a method summary from the platform, V2 first with a V1 fallback.
 * Throws on transport/auth failure so the caller can surface offline state.
 */
async function fetchSummary(uuid: string): Promise<MethodSummary | null> {
  const headers = await authHeaders();
  let v2Error: unknown;
  try {
    const summary = summaryFromV2(await getJson(chainV2Path(uuid), headers));
    if (summary) return summary;
    v2Error = new Error('V2 response had no name or category');
  } catch (err) {
    // 401/403 will fail identically on V1, and a blocked origin will too —
    // surface those immediately instead of doubling the failed requests.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.transport)) {
      throw new ApiError(
        err.status ? `not signed in to this site (HTTP ${err.status})` : err.message,
        err.status,
        err.transport
      );
    }
    v2Error = err;
  }

  try {
    return summaryFromV1(await getJson(chainV1Path(uuid), headers));
  } catch (err) {
    // Report both attempts — knowing V2 404'd but V1 401'd is the difference
    // between "old platform build" and "not signed in".
    throw new ApiError(
      `v2: ${errorText(v2Error) || 'failed'} · v1: ${errorText(err) || 'failed'}`,
      err instanceof ApiError ? err.status : undefined
    );
  }
}

/**
 * Resolve a uuid to its summary, cache-first. Null when the uuid resolves to
 * nothing. `onRevalidated` is called if a stale entry was served first and the
 * background refresh produced data.
 */
export async function resolveSummary(
  uuid: string,
  onRevalidated?: (summary: MethodSummary) => void
): Promise<MethodSummary | null> {
  const origin = getApiOrigin();
  const cached = cacheRead(origin, uuid);

  if (cached && !cached.stale) return cached.data;

  if (cached && cached.stale) {
    // Serve stale immediately; refresh behind the user's back.
    revalidate(uuid, origin, onRevalidated);
    return cached.data;
  }

  const pending = inFlight.get(uuid);
  if (pending) return pending;

  const task = (async () => {
    try {
      const summary = await fetchSummary(uuid);
      if (summary) cacheWrite(origin, uuid, summary);
      return summary;
    } finally {
      inFlight.delete(uuid);
    }
  })();
  inFlight.set(uuid, task);
  return task;
}

function revalidate(
  uuid: string,
  origin: string,
  onRevalidated?: (summary: MethodSummary) => void
): void {
  if (inFlight.has(uuid)) return;
  const task = (async () => {
    try {
      const summary = await fetchSummary(uuid);
      if (summary) {
        cacheWrite(origin, uuid, summary);
        onRevalidated?.(summary);
      }
      return summary;
    } catch {
      return null; // stale data stays on screen — a background refresh failing is not an error
    } finally {
      inFlight.delete(uuid);
    }
  })();
  inFlight.set(uuid, task);
}

/**
 * Record a name we learned for free — from a definition-fetch response body
 * the panel already had in hand — so the next panel open resolves it from
 * cache instead of re-asking the platform. Merges into any existing entry so
 * a cached category is not dropped.
 */
export function rememberName(uuid: string, name: string): void {
  if (!uuid || !name) return;
  const origin = getApiOrigin();
  if (!origin) return;
  const existing = cacheRead(origin, uuid);
  const prev: Partial<MethodSummary> = existing?.data || {};
  if (prev.name === name) return;
  cacheWrite(origin, uuid, { ...prev, name });
}

/**
 * Build the designer URL for a method. The AD UI addresses methods by DRAFT
 * uuid; a published row points at its linked draft via referenceId. Null when
 * there is no summary to route with.
 */
export function buildDesignerUrl(
  uuid: string,
  summary: Partial<MethodSummary> | null
): string | null {
  if (!summary) return null;
  const category = summary.category || 'Uncategorized';
  const draftUuid =
    summary.state === 'PUBLISHED' && summary.referenceId ? summary.referenceId : uuid;
  return getDesignerOrigin() + designerPath(category, draftUuid);
}
