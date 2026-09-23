// Direct client for the Automation Designer REST API.
//
// The AD Network panel needs two things the raw network log cannot give it:
// the human-readable name/category behind an `execute` uuid, and the
// designer URL to open that method in. Both come from the chain definition
// endpoint on the inspected host itself — the same endpoint the page's own
// designer calls.
//
// Only ever on an allowed site: every lookup first checks that the inspected
// page is https on a granted host (InspectedSite.isAllowed), because DevTools
// stays open when the tab navigates elsewhere.
//
// Auth, in order of preference, and always for the origin it came from:
//
//   1. The Authorization / Expertly-Auth-Token header lifted off a real chain
//      request we observed on that origin. Exact: whatever the app sends, we
//      send, and only back to the origin it was sent to.
//   2. The page's own sign-in token, read from the inspected page's storage:
//      the AD key (`localStorage.authToken`) first, else the first JWT found.
//      The scan reports the origin it ran on, and the token is only sent to
//      that origin. A failed scan is not remembered, and a 401/403 drops the
//      token and scans once more.
//   3. Cookies alone (`credentials: 'include'`). Works on cookie-session
//      deployments. Requires the host grant from the options page.
//
// forgetAuth() drops everything learned; the panel calls it whenever the
// inspected page navigates. Results are memoised in MethodCache (cache.ts),
// so a repeat visit resolves names with no network at all.

import { chainV1Path, chainV2Path, designerPath } from '../../config/endpoints';
import type { InspectedSite } from './origin';
import type { MethodCache } from './cache';
import { asObject, definitionOf, firstString, nameFromDefinition } from './extract';
import { evalInPage } from '../inspected';
import { errorText, isTransientStatus } from '../../shared/errors';
import { createLogger } from '../../shared/logger';
import type { MethodSummary } from './types';

const log = createLogger('ad-network');

/** Header names worth replaying, lowercased. */
const AUTH_HEADERS = ['authorization', 'expertly-auth-token'];

/**
 * Runs in the inspected page. Returns `{ origin, token }`: the page's own
 * origin, and its sign-in token or null. The Automation Designer keeps it
 * under `authToken` (possibly JSON-quoted); failing that, the first JWT in
 * local or session storage.
 */
const TOKEN_SCAN = `(function () {
  var JWT = /eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]+/;
  var token = null;
  try {
    var known = window.localStorage && window.localStorage.getItem('authToken');
    if (typeof known === 'string' && known) {
      try { var parsed = JSON.parse(known); if (typeof parsed === 'string') known = parsed; } catch (e) {}
      if (/^[A-Za-z0-9._~+/=-]+$/.test(known)) token = known;
    }
    var stores = [window.localStorage, window.sessionStorage];
    for (var s = 0; !token && s < stores.length; s++) {
      var st = stores[s];
      if (!st) continue;
      for (var i = 0; i < st.length; i++) {
        var v = st.getItem(st.key(i));
        var m = typeof v === 'string' ? v.match(JWT) : null;
        if (m) { token = m[0]; break; }
      }
    }
  } catch (e) {}
  return { origin: location.origin, token: token };
})()`;

/** A failed API call: an HTTP error (`status`) or an unreachable host (`transport`). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly transport = false,
    /** A failure that will not clear by itself (not an allowed site, say). */
    readonly final = false
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * True when a failed resolve may succeed later without anything else
 * changing: the host was unreachable, the user is not signed in yet (401/403),
 * the server was busy or broken (408, 429, 5xx), or the failure carried no
 * HTTP status (a non-JSON answer such as a login page). Any other HTTP
 * status (404 on both endpoints, 400, ...) is a definite answer about that
 * uuid and is not retried, and neither is a `final` error.
 */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  if (err.final) return false;
  if (err.transport || err.status === undefined) return true;
  return isAuthFailure(err) || isTransientStatus(err.status);
}

const isAuthFailure = (err: unknown): boolean =>
  err instanceof ApiError && (err.status === 401 || err.status === 403);

type Headers = Record<string, string>;

/** Normalise a V2 chain document down to the fields the panel needs. */
function summaryFromV2(raw: unknown): MethodSummary | null {
  const doc = asObject(raw);
  if (!doc) return null;
  const metadata = asObject(doc.metadata);
  const service = asObject(metadata?.service);
  const name = firstString(doc.name, doc.aliasName, metadata?.name);
  const category = firstString(service?.name, metadata?.categoryName);
  if (!name && !category) return null;
  return {
    name,
    category,
    state: firstString(metadata?.state) || 'DRAFT',
    referenceId: firstString(metadata?.referenceId)
  };
}

/** Normalise a V1 chain document. The body lives inside `jsonDefinition`. */
function summaryFromV1(raw: unknown): MethodSummary | null {
  const doc = asObject(raw);
  if (!doc) return null;
  const name = firstString(nameFromDefinition(definitionOf(doc)), doc.aliasName, doc.name);
  const category = firstString(asObject(doc.category)?.name);
  if (!name && !category) return null;
  return {
    name,
    category,
    state: firstString(doc.automationState) || 'DRAFT',
    referenceId: firstString(doc.referenceId)
  };
}

async function getJson(origin: string, path: string, headers: Headers): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(origin + path, {
      method: 'GET',
      credentials: 'include',
      // A redirect would carry the auth headers to wherever it points, so
      // the request fails instead of following one.
      redirect: 'error',
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

/** The origin of a URL, or null when it has none. */
function originOf(url: unknown): string | null {
  try {
    return typeof url === 'string' ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** True when a summary can route to the designer: it has a category and a state. */
const isComplete = (summary: MethodSummary): boolean => Boolean(summary.category && summary.state);

/**
 * Resolves AD method uuids to their name, category and designer URL, for the
 * page DevTools is inspecting. Results are memoised in the method cache.
 */
export class MethodResolver {
  /** Headers harvested from observed requests, per request origin. */
  private readonly harvested = new Map<string, Headers>();
  /** The last successful token scan, and the origin it was read on. */
  private scanned: { origin: string; token: string } | null = null;
  /** In-flight resolves, so a burst of rows for one uuid makes one request. */
  private readonly inFlight = new Map<string, Promise<MethodSummary | null>>();

  constructor(
    private readonly site: InspectedSite,
    private readonly cache: MethodCache
  ) {}

  /**
   * Lift auth headers off an observed AD chain request, for that request's
   * origin only, and only on an allowed site. Called for every entry the panel
   * captures; the last one wins so a refreshed token replaces a stale one.
   */
  rememberAuth(
    har: {
      request?: { url?: string; headers?: ReadonlyArray<{ name: string; value: string }> };
    } | null | undefined
  ): void {
    const headers = har?.request?.headers;
    const origin = originOf(har?.request?.url);
    if (!Array.isArray(headers) || !origin || !this.site.isAllowedOrigin(origin)) return;
    const found: Headers = {};
    for (const h of headers) {
      if (!h || typeof h.name !== 'string' || typeof h.value !== 'string') continue;
      if (AUTH_HEADERS.includes(h.name.toLowerCase()) && h.value) found[h.name] = h.value;
    }
    if (Object.keys(found).length) this.harvested.set(origin, found);
  }

  /** Forget every header and token learned: the inspected page navigated. */
  forgetAuth(): void {
    this.harvested.clear();
    this.scanned = null;
  }

  /**
   * Resolve a uuid to its summary, cache-first. Null when the uuid resolves to
   * nothing. `onRevalidated` is called if a stale entry was served first and
   * the background refresh produced data. Rejects, without asking anyone,
   * when the inspected page is not on an allowed site.
   */
  async resolveSummary(
    uuid: string,
    onRevalidated?: (summary: MethodSummary) => void
  ): Promise<MethodSummary | null> {
    const origin = this.site.apiOrigin;
    if (!origin || !this.site.isAllowed) {
      throw new ApiError('this page is not on an allowed site', undefined, false, true);
    }
    const hit = this.cache.read(origin, uuid);
    // An entry without a category or state cannot route to the designer, so
    // it is asked for again rather than served.
    const cached = hit && isComplete(hit.data) ? hit : null;

    if (cached && !cached.stale) return cached.data;

    if (cached && cached.stale) {
      // Serve stale immediately; refresh behind the user's back.
      this.revalidate(uuid, origin, onRevalidated);
      return cached.data;
    }

    const key = `${origin}|${uuid}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const task = (async () => {
      try {
        const summary = await this.fetchSummary(origin, uuid);
        if (summary) this.cache.write(origin, uuid, summary);
        return summary;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, task);
    return task;
  }

  /**
   * Build the designer URL for a method. The AD UI addresses methods by
   * category and DRAFT uuid; a published method opens its linked draft
   * (referenceId). Null when the summary cannot route there: no summary, no
   * category, or the designer origin is unknown. Nothing is guessed.
   */
  buildDesignerUrl(uuid: string, summary: MethodSummary | null): string | null {
    const origin = this.site.designerOrigin;
    if (!summary?.category || !origin) return null;
    const draftUuid =
      summary.state === 'PUBLISHED' && summary.referenceId ? summary.referenceId : uuid;
    return origin + designerPath(summary.category, draftUuid);
  }

  private revalidate(
    uuid: string,
    origin: string,
    onRevalidated?: (summary: MethodSummary) => void
  ): void {
    const key = `${origin}|${uuid}`;
    if (this.inFlight.has(key)) return;
    const task = (async () => {
      try {
        const summary = await this.fetchSummary(origin, uuid);
        if (summary) {
          this.cache.write(origin, uuid, summary);
          onRevalidated?.(summary);
        }
        return summary;
      } catch (err) {
        // Stale data stays on screen: a background refresh failing is not an error.
        log.debug(`revalidating ${uuid} failed:`, err);
        return null;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, task);
  }

  /** The page's token for `origin`: remembered, or scanned now. Null when none. */
  private async tokenFor(origin: string): Promise<string | null> {
    if (this.scanned?.origin === origin) return this.scanned.token;
    const result = asObject(await evalInPage(TOKEN_SCAN));
    const token = typeof result?.token === 'string' && result.token ? result.token : null;
    // Only a token read on the very origin we are about to call is usable:
    // the page may have navigated between the request and the scan.
    if (!token || result?.origin !== origin) return null;
    this.scanned = { origin, token };
    return token;
  }

  /** What to authenticate a request to `origin` with. */
  private async authHeaders(origin: string): Promise<{ headers: Headers; source: 'har' | 'scan' | 'none' }> {
    const harvested = this.harvested.get(origin);
    if (harvested) return { headers: { ...harvested }, source: 'har' };
    const token = await this.tokenFor(origin);
    return token
      ? { headers: { Authorization: `Bearer ${token}` }, source: 'scan' }
      : { headers: {}, source: 'none' };
  }

  /** Forget the credentials of `source` for `origin`: the server refused them. */
  private dropAuth(origin: string, source: 'har' | 'scan' | 'none'): void {
    if (source === 'har') this.harvested.delete(origin);
    if (source === 'scan' && this.scanned?.origin === origin) this.scanned = null;
  }

  /**
   * Fetch a method summary. A 401/403 with remembered credentials drops them
   * and tries once more with fresh ones (a new scan, or cookies alone).
   */
  private async fetchSummary(origin: string, uuid: string): Promise<MethodSummary | null> {
    const auth = await this.authHeaders(origin);
    try {
      return await this.fetchWith(origin, uuid, auth.headers);
    } catch (err) {
      if (!isAuthFailure(err) || auth.source === 'none') throw err;
      this.dropAuth(origin, auth.source);
      log.debug(`HTTP ${(err as ApiError).status} with the ${auth.source} token; retrying with fresh auth`);
      return this.fetchWith(origin, uuid, (await this.authHeaders(origin)).headers);
    }
  }

  /**
   * One lookup, V2 first with a V1 fallback. Throws on transport/auth
   * failure so the caller can surface offline state.
   */
  private async fetchWith(origin: string, uuid: string, headers: Headers): Promise<MethodSummary | null> {
    let v2Error: unknown;
    try {
      const summary = summaryFromV2(await getJson(origin, chainV2Path(uuid), headers));
      if (summary) return summary;
      v2Error = new Error('V2 response had no name or category');
    } catch (err) {
      // 401/403 will fail identically on V1, and a blocked origin will too —
      // surface those immediately instead of doubling the failed requests.
      if (err instanceof ApiError && (isAuthFailure(err) || err.transport)) {
        throw new ApiError(
          err.status ? `not signed in to this site (HTTP ${err.status})` : err.message,
          err.status,
          err.transport
        );
      }
      v2Error = err;
    }

    try {
      return summaryFromV1(await getJson(origin, chainV1Path(uuid), headers));
    } catch (err) {
      // Report both attempts — knowing V2 404'd but V1 401'd is the difference
      // between "old platform build" and "not signed in".
      throw new ApiError(
        `v2: ${errorText(v2Error) || 'failed'} · v1: ${errorText(err) || 'failed'}`,
        err instanceof ApiError ? err.status : undefined
      );
    }
  }
}
