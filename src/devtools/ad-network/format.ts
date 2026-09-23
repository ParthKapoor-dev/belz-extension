// Pure helpers of the AD Network panel: reading and formatting HAR entries.
// No DOM, no state.

import type { HarEntry } from './types';

export type StatusGroup = 'ok' | 'redir' | 'clienterr' | 'srverr' | 'error';

export function formatBytes(n: number): string {
  if (typeof n !== 'number' || n < 0 || !isFinite(n)) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' kB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

/** The resource type DevTools reports, else the response MIME type. */
export function typeOf(har: HarEntry): string {
  if (har._resourceType) return har._resourceType;
  const mime = har.response && har.response.content && har.response.content.mimeType;
  if (typeof mime === 'string' && mime) return mime.split(';')[0]!;
  return '—';
}

/** Transfer size in bytes, or -1 when unknown. */
export function transferSize(har: HarEntry): number {
  const r = har.response || {};
  if (typeof r._transferSize === 'number' && r._transferSize >= 0) return r._transferSize;
  if (typeof r.bodySize === 'number' && r.bodySize >= 0) return r.bodySize;
  const c = r.content || {};
  if (typeof c.size === 'number' && c.size >= 0) return c.size;
  return -1;
}

// Group an HTTP status into a colour bucket. A finished entry with status 0 is
// a cancel/error — DevTools delivers it via onRequestFinished (or includes it
// in the HAR log) only after it terminates, so status 0 here means "did not
// complete", not "still in flight".
export function statusGroup(status: number | null | undefined): StatusGroup {
  if (status === 0 || status == null) return 'error';
  if (status >= 500) return 'srverr';
  if (status >= 400) return 'clienterr';
  if (status >= 300) return 'redir';
  if (status >= 200) return 'ok';
  return 'error';
}

/** A copy-pasteable cURL command for a captured request. */
export function buildCurl(har: HarEntry): string {
  const req = har.request;
  const q = (s: unknown) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const parts = ['curl ' + q(req.url || '')];
  if (req.method && req.method.toUpperCase() !== 'GET') {
    parts.push('-X ' + req.method.toUpperCase());
  }
  for (const h of req.headers || []) {
    if (!h || !h.name || h.name.charAt(0) === ':') continue;
    parts.push('-H ' + q(h.name + ': ' + (h.value || '')));
  }
  const bodyText = req.postData && req.postData.text;
  if (bodyText) parts.push('--data-raw ' + q(bodyText));
  return parts.join(' \\\n  ');
}

// Start time as epoch ms. Comparing the raw startedDateTime STRINGS is wrong:
// browsers emit local time with a UTC offset (`…T17:04:56.789+05:30`), and two
// timestamps carrying different offsets sort lexicographically in the OPPOSITE
// order to the instants they represent — `12:34:57+00:00` sorts before
// `17:04:56+05:30` despite being a second later. Parsing normalises every
// source (getHAR replay, live onRequestFinished, either browser) to one scale.
export function startedAt(har: HarEntry): number {
  const raw = har && har.startedDateTime;
  if (typeof raw === 'string' && raw) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

// Dedup key for a captured request. The timestamp is normalised to epoch ms
// rather than used raw: the same request can reach us twice — once replayed
// from getHAR(), once live from onRequestFinished — and if those two sources
// format startedDateTime differently (offset vs Z, or differing fractional
// precision) a raw-string key treats them as two distinct requests, which
// shows up as a duplicated row sitting in the wrong place.
export function harKey(har: HarEntry): string {
  const url = (har && har.request && har.request.url) || '';
  return url + '|' + startedAt(har);
}

type Header = { name: string; value: string };

export function headerRows(headers: Header[] | undefined): Array<[string, unknown]> {
  return Array.isArray(headers) ? headers.map((h): [string, unknown] => [h.name, h.value]) : [];
}

export function headersToObj(headers: Header[] | undefined): Record<string, string> {
  const o: Record<string, string> = {};
  for (const h of headers || []) {
    if (h && h.name) o[h.name] = h.value;
  }
  return o;
}

/** `text` re-indented if it is JSON, as-is otherwise. */
export function prettyMaybeJson(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) return typeof text === 'string' ? text : '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** A short form of the chain uuid in a URL, for in-flight rows. */
export function shortUuidFromUrl(url: string): string | null {
  const m = String(url || '').match(/[0-9a-f]{32}/i);
  return m ? m[0].slice(0, 12) + '…' : null;
}

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : err ? String(err) : '';

/** Why a method lookup failed, for a toast: never empty. */
export const lookupFailure = (err: unknown): string => errorText(err) || 'lookup failed';

/** A uuid shortened for toasts and link labels. */
export const shortUuid = (uuid: string): string => uuid.slice(0, 8) + '…';
