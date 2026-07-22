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
// Results are memoised through ad-cache.js, so a repeat visit resolves names
// with no network at all.

import { chainV1Path, chainV2Path, designerPath } from '../config/endpoints.js';
import { getApiOrigin, getDesignerOrigin } from './ad-origin.js';
import { read as cacheRead, write as cacheWrite } from './ad-cache.js';

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

/** Headers harvested from an observed request. */
let harvested = null;
let scannedToken = null;
let scanTried = false;

/** In-flight resolves, so a burst of rows for one uuid makes one request. */
const inFlight = new Map();

/**
 * Lift auth headers off an observed AD chain request. Called for every entry
 * the panel captures; the last one wins so a refreshed token replaces a
 * stale one.
 */
export function rememberAuth(har) {
  const headers = har && har.request && har.request.headers;
  if (!Array.isArray(headers)) return;
  const found = {};
  for (const h of headers) {
    if (!h || typeof h.name !== 'string' || typeof h.value !== 'string') continue;
    const name = h.name.toLowerCase();
    if (AUTH_HEADERS.includes(name) && h.value) found[h.name] = h.value;
  }
  if (Object.keys(found).length) harvested = found;
}

/** True once we have credentials good enough to expect a 200. */
export function hasAuth() {
  return Boolean(harvested || scannedToken);
}

async function scanPageToken() {
  if (scanTried) return scannedToken;
  scanTried = true;
  scannedToken = await new Promise((resolve) => {
    try {
      chrome.devtools.inspectedWindow.eval(TOKEN_SCAN, (result) => {
        resolve(typeof result === 'string' && result ? result : null);
      });
    } catch {
      resolve(null);
    }
  });
  return scannedToken;
}

async function authHeaders() {
  if (harvested) return { ...harvested };
  const token = await scanPageToken();
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Normalise a V2 chain document down to the fields the panel needs. */
function summaryFromV2(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const metadata = raw.metadata || {};
  const service = metadata.service || {};
  const name = firstString(raw.name, raw.aliasName, metadata.name);
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
function summaryFromV1(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let def = raw.jsonDefinition;
  if (typeof def === 'string') {
    try {
      def = JSON.parse(def);
    } catch {
      def = null;
    }
  }
  const name = firstString(
    def && def.name,
    def && def.methodName,
    raw.aliasName,
    raw.name
  );
  const category = firstString(raw.category && raw.category.name);
  if (!name && !category) return null;
  return {
    name,
    category,
    state: firstString(raw.automationState) || 'DRAFT',
    referenceId: firstString(raw.referenceId)
  };
}

async function getJson(path, headers) {
  const origin = getApiOrigin();
  if (!origin) throw new Error('inspected origin unknown');
  const res = await fetch(origin + path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json, text/plain, */*', ...headers }
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Fetch a method summary from the platform, V2 first with a V1 fallback.
 * Throws on transport/auth failure so the caller can surface offline state.
 */
async function fetchSummary(uuid) {
  const headers = await authHeaders();
  try {
    return summaryFromV2(await getJson(chainV2Path(uuid), headers));
  } catch (err) {
    // 404 means "not a V2 chain on this build" or "not an AD method at all" —
    // both are worth one V1 attempt. 401/403 will fail the same way twice, so
    // let those through immediately.
    if (err && (err.status === 401 || err.status === 403)) throw err;
    return summaryFromV1(await getJson(chainV1Path(uuid), headers));
  }
}

/**
 * Resolve a uuid to `{ name, category, state, referenceId }`, cache-first.
 *
 * @param {string} uuid
 * @param {(summary: object) => void} [onRevalidated] called if a stale entry
 *   was served first and the background refresh produced different data.
 * @returns {Promise<object|null>} null when the uuid resolves to nothing.
 */
export async function resolveSummary(uuid, onRevalidated) {
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

function revalidate(uuid, origin, onRevalidated) {
  if (inFlight.has(uuid)) return;
  const task = (async () => {
    try {
      const summary = await fetchSummary(uuid);
      if (summary) {
        cacheWrite(origin, uuid, summary);
        if (typeof onRevalidated === 'function') onRevalidated(summary);
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
 * Build the designer URL for a method. The AD UI addresses methods by DRAFT
 * uuid; a published row points at its linked draft via referenceId.
 *
 * @returns {string|null} null when the summary lacks a category to route with.
 */
export function buildDesignerUrl(uuid, summary) {
  if (!summary) return null;
  const category = summary.category || 'Uncategorized';
  const draftUuid =
    summary.state === 'PUBLISHED' && summary.referenceId ? summary.referenceId : uuid;
  return getDesignerOrigin() + designerPath(category, draftUuid);
}
