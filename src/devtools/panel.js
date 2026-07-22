// "AD Network" DevTools panel.
//
// A custom Network-tab-style panel scoped to Automation Designer "chain"
// requests. Two capture pipelines feed the list:
//   1. chrome.devtools.network — the log DevTools already records, replayed
//      on init via getHAR() and streamed live via onRequestFinished. Zero
//      page overhead, but only sees COMPLETED requests.
//   2. pending-capture.js — a fetch/XHR wrapper injected into the inspected
//      page via inspectedWindow.eval. Reports in-flight requests so we can
//      show pending rows the same way the OG Network tab does.
//
// Name + category come from two sources:
//   - definition fetches  -> the name is in the recorded response body
//   - ad-api.js           -> the platform's own chain endpoint on the
//                            inspected host, cached SWR in ad-cache.js

import {
  classifyChainUrl,
  extractMethodNameFromChainResponse
} from './extract.js';
import { createJsonView } from './json-tree.js';
import { startPendingCapture } from './pending-capture.js';
import {
  detectOrigin,
  getApiHost,
  loadSiteConfig,
  watchSiteConfig
} from './ad-origin.js';
import {
  rememberAuth,
  resolveSummary,
  buildDesignerUrl
} from './ad-api.js';
import { hydrate as hydrateCache } from './ad-cache.js';
import { AUTOFILL_PARAM } from '../config/endpoints.js';
import { FOCUS_STORAGE_KEY } from '../config/storage-keys.js';

const MAX_ROWS = 300;
const RESOLVE_DEBOUNCE_MS = 250;
const RESOLVE_RETRY_MS = 4000;
/** Never hammer the platform with a burst — resolve a few uuids at a time. */
const RESOLVE_CONCURRENCY = 4;

// ---- DOM ------------------------------------------------------------------
const recordBtn = document.getElementById('record');
const clearBtn = document.getElementById('clear');
const preserveBox = document.getElementById('preserve');
const filterInput = document.getElementById('filter');
const countEl = document.getElementById('count');
const offlineEl = document.getElementById('offline');
const listPane = document.querySelector('.list-pane');
const rowsEl = document.getElementById('rows');
const emptyEl = document.getElementById('empty');
const detailEl = document.getElementById('detail');
const detailBody = document.getElementById('detail-body');
const detailClose = document.getElementById('detail-close');
const detailCopy = document.getElementById('detail-copy');
const detailTabs = Array.from(document.querySelectorAll('.detail-tabs button'));
const toastEl = document.getElementById('toast');

// ---- state ----------------------------------------------------------------
const entries = []; // chronological (oldest-first by har.startedDateTime), mirrors DOM order
const seen = new Set(); // dedup key = request.url + '|' + har.startedDateTime
const uuidToName = new Map();
const uuidToCategory = new Map();
let nextId = 1;
let recording = true;
let preserveLog = false;
let filterText = '';
let selectedId = null;
let activeTab = 'headers';
let currentCopyText = '';

const pendingUuids = new Set();
let resolveTimer = null;
let resolveRetryTimer = null;
/** Resolves once origin + site config + cache are loaded. Set at init. */
let ready = Promise.resolve();

// "Open in draft" queue — processed one at a time.
const openQueue = [];
let openProcessing = false;

// Origin detection + designer-host mapping live in ./ad-origin.js.

// ---- small helpers --------------------------------------------------------
function formatBytes(n) {
  if (typeof n !== 'number' || n < 0 || !isFinite(n)) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' kB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function typeOf(har) {
  if (har._resourceType) return har._resourceType;
  const mime =
    har.response && har.response.content && har.response.content.mimeType;
  if (typeof mime === 'string' && mime) return mime.split(';')[0];
  return '—';
}

function transferSize(har) {
  const r = har.response || {};
  if (typeof r._transferSize === 'number' && r._transferSize >= 0) {
    return r._transferSize;
  }
  if (typeof r.bodySize === 'number' && r.bodySize >= 0) return r.bodySize;
  const c = r.content || {};
  if (typeof c.size === 'number' && c.size >= 0) return c.size;
  return -1;
}

// Group an HTTP status into a colour bucket (#9). A finished entry with
// status 0 is a cancel/error — DevTools delivers it via onRequestFinished (or
// includes it in the HAR log) only after it terminates, so status 0 here means
// "did not complete", not "still in flight".
function statusGroup(status) {
  if (status === 0 || status == null) return 'error';
  if (status >= 500) return 'srverr';
  if (status >= 400) return 'clienterr';
  if (status >= 300) return 'redir';
  if (status >= 200) return 'ok';
  return 'error';
}

function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) Object.assign(node, props);
  for (const k of kids) {
    if (k == null) continue;
    node.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return node;
}

let toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3000);
}

// ---- row action buttons ---------------------------------------------------
const ICON_COPY =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/>' +
  '<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const ICON_OPEN =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M11 13 20 4"/>' +
  '<path d="M19 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></svg>';
const ICON_LINK =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
  '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

function iconButton(svg, title, handler) {
  const b = document.createElement('button');
  b.className = 'act';
  b.type = 'button';
  b.title = title;
  b.innerHTML = svg;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    handler(b);
  });
  return b;
}

function flashOk(btn) {
  btn.classList.add('ok');
  setTimeout(() => btn.classList.remove('ok'), 700);
}

// Build a copy-pasteable cURL command from a captured request.
function buildCurl(har) {
  const req = (har && har.request) || {};
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
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

// Copy a Slack-pasteable rich link to the method's designer page — mirrors the
// Shift+L "copy AD rich link" feature on AD pages. The designer URL is built
// from the method summary read off the platform (same path "open in draft"
// takes).
async function copySlackLink(entry, btn) {
  try {
    await ready;
    const summary = await resolveSummary(entry.uuid, (fresh) =>
      applySummary(entry.uuid, fresh)
    );
    const url = buildDesignerUrl(entry.uuid, summary);
    if (!url) throw new Error('method not found on this instance');
    applySummary(entry.uuid, summary);
    setOffline(false);
    const name =
      (summary && summary.name) ||
      uuidToName.get(entry.uuid) ||
      entry.uuid.slice(0, 8) + '…';
    const category =
      (summary && summary.category) || uuidToCategory.get(entry.uuid) || '';
    const label = [category, name].filter(Boolean).join('::');
    const html = '<a href="' + url + '">' + label + '</a>';
    const plain = '[' + label + '](' + url + ')';
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        })
      ]);
    } catch {
      await navigator.clipboard.writeText(plain);
    }
    flashOk(btn);
    showToast('copied link · ' + label);
  } catch (err) {
    setOffline(true);
    showToast(
      'could not copy link — ' +
        (err && err.message ? err.message : 'lookup failed')
    );
  }
}

// ---- "open in draft" queue (#3, #11) --------------------------------------
// Opens the method's draft designer page, with inputs autofilled, in a
// BACKGROUND tab — the user stays on the page they are already on.
function openTab(url) {
  try {
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url, active: false });
      return;
    }
  } catch {
    /* fall through to window.open */
  }
  try {
    window.open(url, '_blank');
  } catch {
    /* ignore */
  }
}

function enqueueOpen(entry) {
  openQueue.push(entry);
  showToast(
    'queued ' +
      (uuidToName.get(entry.uuid) || entry.uuid.slice(0, 8) + '…') +
      ' · ' +
      openQueue.length +
      ' in queue'
  );
  processOpenQueue();
}

async function processOpenQueue() {
  if (openProcessing) return;
  const entry = openQueue.shift();
  if (!entry) return;
  openProcessing = true;
  try {
    await ready;
    const summary = await resolveSummary(entry.uuid, (fresh) =>
      applySummary(entry.uuid, fresh)
    );
    let url = buildDesignerUrl(entry.uuid, summary);
    if (!url) throw new Error('method not found on this instance');
    applySummary(entry.uuid, summary);
    setOffline(false);
    const req = entry.har && entry.har.request;
    const body = (req && req.postData && req.postData.text) || '';
    if (body) {
      try {
        url +=
          (url.includes('?') ? '&' : '?') +
          AUTOFILL_PARAM + '=' +
          encodeURIComponent(btoa(body));
      } catch {
        /* body not Latin1 — open without autofill */
      }
    }
    openTab(url);
    const remaining = openQueue.length;
    showToast(
      'opening ' +
        ((summary && summary.name) || entry.uuid.slice(0, 8) + '…') +
        ' in draft mode' +
        (remaining ? ' · ' + remaining + ' queued' : '')
    );
  } catch (err) {
    setOffline(true);
    showToast(
      'could not open ' +
        entry.uuid.slice(0, 8) +
        '… — ' +
        (err && err.message ? err.message : 'lookup failed')
    );
  } finally {
    openProcessing = false;
    if (openQueue.length) setTimeout(processOpenQueue, 150);
  }
}

// ---- name / category resolution -------------------------------------------
function learnName(uuid, name) {
  if (!uuid || !name || uuidToName.get(uuid) === name) return;
  uuidToName.set(uuid, name);
  for (const entry of entries) {
    if (entry.uuid === uuid) paintName(entry);
  }
  reRenderDetailIf(uuid);
}

function learnCategory(uuid, category) {
  if (!uuid || !category || uuidToCategory.get(uuid) === category) return;
  uuidToCategory.set(uuid, category);
  for (const entry of entries) {
    if (entry.uuid === uuid) paintCategory(entry);
  }
  reRenderDetailIf(uuid);
}

function reRenderDetailIf(uuid) {
  if (selectedId == null || activeTab !== 'headers') return;
  const sel = entries.find((e) => e.id === selectedId);
  if (sel && sel.uuid === uuid) renderDetail();
}

function paintName(entry) {
  const name = uuidToName.get(entry.uuid);
  entry.nameCell.className = 'name s-' + entry.statusGroup + (name ? '' : ' pending');
  entry.nameCell.textContent = name || entry.uuid.slice(0, 12) + '…';
  entry.nameCell.title = name
    ? name + '  ·  click to see details'
    : entry.uuid + '  (resolving…)';
}

function paintCategory(entry) {
  const cat = uuidToCategory.get(entry.uuid);
  entry.categoryCell.className = cat ? 'category' : 'category pending';
  entry.categoryCell.textContent = cat || '…';
  entry.categoryCell.title = cat ? cat + '  ·  click to see details' : '';
}

function setOffline(off) {
  offlineEl.classList.toggle('hidden', !off);
}

/** Paint whatever a summary told us onto every row sharing that uuid. */
function applySummary(uuid, summary) {
  if (!summary) return;
  if (summary.name) learnName(uuid, summary.name);
  if (summary.category) learnCategory(uuid, summary.category);
}

function needsResolve(uuid) {
  return !uuidToName.has(uuid) || !uuidToCategory.has(uuid);
}

function scheduleResolve() {
  if (resolveTimer) return;
  resolveTimer = setTimeout(() => {
    resolveTimer = null;
    flushResolve();
  }, RESOLVE_DEBOUNCE_MS);
}

/**
 * Resolve every queued uuid against the platform, a few at a time. Cache hits
 * return without touching the network, so a warm panel paints instantly.
 * A uuid that fails for transport/auth reasons goes back on the queue — the
 * user may still be signing in, or the page may not have fired an
 * authenticated request yet for us to lift a token from.
 */
async function flushResolve() {
  await ready;
  const uuids = [];
  for (const uuid of pendingUuids) {
    if (needsResolve(uuid)) uuids.push(uuid);
  }
  pendingUuids.clear();
  if (uuids.length === 0) return;

  const failed = [];
  let cursor = 0;
  async function worker() {
    while (cursor < uuids.length) {
      const uuid = uuids[cursor++];
      try {
        const summary = await resolveSummary(uuid, (fresh) =>
          applySummary(uuid, fresh)
        );
        // A null summary is a definitive miss (the uuid is not an AD method
        // on this instance) — do not retry it.
        applySummary(uuid, summary);
      } catch {
        failed.push(uuid);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(RESOLVE_CONCURRENCY, uuids.length) }, worker)
  );

  setOffline(failed.length > 0);
  if (failed.length === 0) return;

  for (const uuid of failed) {
    if (needsResolve(uuid)) pendingUuids.add(uuid);
  }
  if (pendingUuids.size > 0 && !resolveRetryTimer) {
    resolveRetryTimer = setTimeout(() => {
      resolveRetryTimer = null;
      flushResolve();
    }, RESOLVE_RETRY_MS);
  }
}

// ---- request capture ------------------------------------------------------
function harKey(har) {
  const url = (har && har.request && har.request.url) || '';
  return url + '|' + (har.startedDateTime || '');
}

// Find the chronological insert index for a new entry. entries[] is kept
// sorted by har.startedDateTime ascending — ISO 8601 sorts lexicographically.
function insertIndexFor(started) {
  let i = entries.length;
  while (i > 0 && (entries[i - 1].har.startedDateTime || '') > started) i--;
  return i;
}

function renumberRows() {
  for (let i = 0; i < entries.length; i++) {
    const cell = entries[i].rowEl && entries[i].rowEl.firstChild;
    if (cell) cell.textContent = String(i + 1);
  }
}

function onRequest(har) {
  if (!recording) return;
  const req = har && har.request;
  const info = req ? classifyChainUrl(req.url) : null;
  if (!info) return;

  const key = harKey(har);
  if (seen.has(key)) return;
  seen.add(key);

  // Every observed chain request is a chance to learn the app's auth headers,
  // which is what lets us query the platform for names ourselves.
  rememberAuth(har);

  const status = (har.response && har.response.status) || 0;
  const entry = {
    id: nextId++,
    uuid: info.uuid,
    kind: info.kind,
    version: info.version,
    httpMethod: req.method || '—',
    url: req.url,
    status,
    statusGroup: statusGroup(status),
    type: typeOf(har),
    size: transferSize(har),
    time: typeof har.time === 'number' ? har.time : -1,
    har,
    rowEl: null,
    nameCell: null,
    categoryCell: null
  };

  // Follow the tail like the real Network tab if already scrolled to bottom
  // AND the new entry is being appended at the end (i.e. it started after
  // everything already visible). Backfilled entries inserted mid-list
  // shouldn't jump the scroll.
  const atBottom =
    listPane.scrollTop + listPane.clientHeight >= listPane.scrollHeight - 4;
  const insertAt = insertIndexFor(har.startedDateTime || '');
  const isAppend = insertAt === entries.length;
  entries.splice(insertAt, 0, entry);
  renderRow(entry, insertAt);
  renumberRows();

  if (atBottom && isAppend) listPane.scrollTop = listPane.scrollHeight;

  // Name: definition fetches carry it in their body — read it instantly.
  // HAR entries from getHAR() lack a working getContent(); ad-api fills in.
  if (info.kind === 'fetch' && typeof har.getContent === 'function') {
    try {
      har.getContent((body) => {
        const name = extractMethodNameFromChainResponse(body || '');
        if (name) learnName(info.uuid, name);
      });
    } catch {
      /* backfill entries: no content available */
    }
  }
  // Name (for execute) + category for every row come from the platform.
  if (needsResolve(info.uuid)) {
    pendingUuids.add(info.uuid);
    scheduleResolve();
  }

  // Cap the table — drop the oldest rows.
  while (entries.length > MAX_ROWS) {
    const old = entries.shift();
    if (old) {
      seen.delete(harKey(old.har));
      if (old.rowEl && old.rowEl.parentNode) old.rowEl.remove();
      if (old.id === selectedId) closeDetail();
    }
  }
  countEl.textContent = String(entries.length);
}

function renderRow(entry, insertAt) {
  emptyEl.classList.add('hidden');

  // # cell text is set by renumberRows() after insertion; placeholder here.
  const srCell = el('td', { className: 'sr' }, '');

  const nameCell = el('td', null);
  const categoryCell = el('td', null);
  entry.nameCell = nameCell;
  entry.categoryCell = categoryCell;
  // Clicking name or category opens the request-details side panel (via the
  // row-level handler below). Only the Actions "Open" button opens draft mode.

  const copyCurlBtn = iconButton(ICON_COPY, 'Copy as cURL', (btn) => {
    try {
      navigator.clipboard.writeText(buildCurl(entry.har));
      flashOk(btn);
    } catch {
      /* ignore */
    }
  });
  const copyLinkBtn = iconButton(ICON_LINK, 'Copy Slack link', (btn) => {
    copySlackLink(entry, btn);
  });
  const openBtn = iconButton(
    ICON_OPEN,
    'Open in draft mode (background tab)',
    (btn) => {
      enqueueOpen(entry);
      flashOk(btn);
    }
  );
  const actionsCell = el(
    'td',
    { className: 'actions' },
    copyCurlBtn,
    copyLinkBtn,
    openBtn
  );

  const statusText = entry.status
    ? String(entry.status)
    : entry.statusGroup === 'error'
      ? 'canceled'
      : '—';
  const statusBadge = el(
    'span',
    { className: 'sbadge ' + entry.statusGroup },
    statusText
  );
  const statusCell = el('td', null, statusBadge);

  const httpCell = el('td', { className: 'dim' }, entry.httpMethod);

  const badge = el(
    'span',
    { className: 'badge ' + (entry.kind === 'execute' ? 'run' : 'get') },
    entry.kind === 'execute' ? 'RUN' : 'GET'
  );
  const kindCell = el('td', { className: 'dim' }, badge, ' ' + entry.version);

  const idCell = el(
    'td',
    { className: 'mono', title: entry.uuid + '  ·  click to copy' },
    entry.uuid
  );
  idCell.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      navigator.clipboard.writeText(entry.uuid);
    } catch {
      /* ignore */
    }
    const prev = idCell.textContent;
    idCell.textContent = 'copied';
    setTimeout(() => {
      idCell.textContent = prev;
    }, 700);
  });

  const typeCell = el('td', { className: 'dim' }, entry.type);
  const sizeCell = el('td', { className: 'dim' }, formatBytes(entry.size));
  const timeCell = el(
    'td',
    { className: 'dim' },
    entry.time >= 0 ? Math.round(entry.time) + ' ms' : '—'
  );

  const row = el(
    'tr',
    null,
    srCell,
    nameCell,
    categoryCell,
    actionsCell,
    statusCell,
    httpCell,
    kindCell,
    idCell,
    typeCell,
    sizeCell,
    timeCell
  );
  row.addEventListener('click', () => selectEntry(entry));

  entry.rowEl = row;
  paintName(entry);
  paintCategory(entry);
  applyRowFilter(entry);

  const idx = typeof insertAt === 'number' ? insertAt : entries.length - 1;
  const next = entries[idx + 1];
  if (next && next.rowEl && next.rowEl.parentNode === rowsEl) {
    rowsEl.insertBefore(row, next.rowEl);
  } else {
    rowsEl.appendChild(row);
  }
}

// ---- filter ---------------------------------------------------------------
function rowMatches(entry) {
  if (!filterText) return true;
  const name = (uuidToName.get(entry.uuid) || '').toLowerCase();
  const cat = (uuidToCategory.get(entry.uuid) || '').toLowerCase();
  return (
    name.includes(filterText) ||
    cat.includes(filterText) ||
    entry.uuid.includes(filterText) ||
    entry.url.toLowerCase().includes(filterText)
  );
}

function applyRowFilter(entry) {
  if (entry.rowEl) entry.rowEl.classList.toggle('hidden', !rowMatches(entry));
}

function applyFilter() {
  for (const entry of entries) applyRowFilter(entry);
}

// ---- detail pane ----------------------------------------------------------
function selectEntry(entry) {
  selectedId = entry.id;
  for (const e of entries) {
    if (e.rowEl) e.rowEl.classList.toggle('selected', e.id === entry.id);
  }
  detailEl.classList.remove('hidden');
  renderDetail();
}

function closeDetail() {
  selectedId = null;
  detailEl.classList.add('hidden');
  for (const e of entries) {
    if (e.rowEl) e.rowEl.classList.remove('selected');
  }
}

function kvGrid(pairs) {
  const grid = el('div', { className: 'kv' });
  for (const [k, v] of pairs) {
    grid.append(
      el('div', { className: 'k' }, k),
      el('div', { className: 'v' }, v == null || v === '' ? '—' : String(v))
    );
  }
  return grid;
}

function headerRows(headers) {
  return Array.isArray(headers) ? headers.map((h) => [h.name, h.value]) : [];
}

function headersToObj(headers) {
  const o = {};
  for (const h of headers || []) {
    if (h && h.name) o[h.name] = h.value;
  }
  return o;
}

function prettyMaybeJson(text) {
  if (typeof text !== 'string' || !text.trim()) return text || '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function renderDetail() {
  const entry = entries.find((e) => e.id === selectedId);
  if (!entry) return;
  detailBody.replaceChildren();
  currentCopyText = '';
  const har = entry.har;

  if (activeTab === 'headers') {
    const name = uuidToName.get(entry.uuid);
    const category = uuidToCategory.get(entry.uuid);
    detailBody.append(
      el('h4', null, 'General'),
      kvGrid([
        ['Method name', name || '(resolving…)'],
        ['Category', category || '(resolving…)'],
        ['UUID', entry.uuid],
        ['Chain kind', entry.kind + ' (' + entry.version + ')'],
        ['Request URL', entry.url],
        ['HTTP method', entry.httpMethod],
        ['Status', entry.status || '—'],
        ["Host", getApiHost() || "—"]
      ]),
      el('h4', null, 'Request headers'),
      kvGrid(headerRows(har.request && har.request.headers)),
      el('h4', null, 'Response headers'),
      kvGrid(headerRows(har.response && har.response.headers))
    );
    currentCopyText = JSON.stringify(
      {
        general: {
          methodName: name || null,
          category: category || null,
          uuid: entry.uuid,
          chainKind: entry.kind + ' ' + entry.version,
          requestUrl: entry.url,
          httpMethod: entry.httpMethod,
          status: entry.status || null,
          host: getApiHost() || null
        },
        requestHeaders: headersToObj(har.request && har.request.headers),
        responseHeaders: headersToObj(har.response && har.response.headers)
      },
      null,
      2
    );
  } else if (activeTab === 'payload') {
    const post = har.request && har.request.postData;
    const query = har.request && har.request.queryString;
    if (post && typeof post.text === 'string' && post.text) {
      detailBody.append(
        el('h4', null, 'Request payload'),
        createJsonView(post.text).element
      );
      currentCopyText = prettyMaybeJson(post.text);
    }
    if (Array.isArray(query) && query.length) {
      detailBody.append(
        el('h4', null, 'Query string'),
        kvGrid(query.map((q) => [q.name, q.value]))
      );
      if (!currentCopyText) {
        const o = {};
        for (const q of query) o[q.name] = q.value;
        currentCopyText = JSON.stringify(o, null, 2);
      }
    }
    if (!detailBody.childNodes.length) {
      detailBody.append(el('pre', null, 'No request payload.'));
    }
  } else if (activeTab === 'response') {
    detailBody.append(el('pre', null, 'Loading response…'));
    const token = entry.id;
    har.getContent((body) => {
      if (selectedId !== token || activeTab !== 'response') return;
      currentCopyText = body ? prettyMaybeJson(body) : '';
      detailBody.replaceChildren(
        el('h4', null, 'Response body'),
        body ? createJsonView(body).element : el('pre', null, '(empty)')
      );
    });
  } else if (activeTab === 'timing') {
    const t = har.timings || {};
    const rows = [['Total', Math.round(har.time || 0) + ' ms']];
    const obj = { total: Math.round(har.time || 0) };
    for (const key of ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive']) {
      if (typeof t[key] === 'number' && t[key] >= 0) {
        rows.push([key, Math.round(t[key]) + ' ms']);
        obj[key] = Math.round(t[key]);
      }
    }
    detailBody.append(el('h4', null, 'Timing'), kvGrid(rows));
    currentCopyText = JSON.stringify(obj, null, 2);
  }
}

// ---- clearing -------------------------------------------------------------
function clearAll() {
  entries.length = 0;
  seen.clear();
  rowsEl.replaceChildren();
  if (typeof pendingRowsEl !== 'undefined' && pendingRowsEl) {
    pendingRowsEl.replaceChildren();
  }
  if (typeof pendingRows !== 'undefined') pendingRows.clear();
  countEl.textContent = '0';
  emptyEl.classList.remove('hidden');
  closeDetail();
}

// ---- wiring ---------------------------------------------------------------
recordBtn.addEventListener('click', () => {
  recording = !recording;
  recordBtn.classList.toggle('on', recording);
  recordBtn.querySelector('.dot').nextSibling.textContent = recording
    ? ' Recording'
    : ' Paused';
});

clearBtn.addEventListener('click', clearAll);

preserveBox.addEventListener('change', () => {
  preserveLog = preserveBox.checked;
});

filterInput.addEventListener('input', () => {
  filterText = filterInput.value.trim().toLowerCase();
  applyFilter();
});

detailClose.addEventListener('click', closeDetail);

// Copy just the active tab's content — the JSON/body, no section headings (#2).
detailCopy.addEventListener('click', () => {
  try {
    navigator.clipboard.writeText(currentCopyText || '');
    detailCopy.classList.add('ok');
    detailCopy.textContent = 'Copied';
    setTimeout(() => {
      detailCopy.classList.remove('ok');
      detailCopy.textContent = 'Copy';
    }, 900);
  } catch {
    /* ignore */
  }
});

// Arrow-key navigation across visible rows.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
  const visible = entries.filter(
    (en) => en.rowEl && !en.rowEl.classList.contains('hidden')
  );
  if (visible.length === 0) return;
  e.preventDefault();
  let idx = visible.findIndex((en) => en.id === selectedId);
  if (e.key === 'ArrowDown') {
    idx = idx < 0 ? 0 : Math.min(idx + 1, visible.length - 1);
  } else {
    idx = idx < 0 ? 0 : Math.max(idx - 1, 0);
  }
  const target = visible[idx];
  if (target) {
    selectEntry(target);
    if (target.rowEl) target.rowEl.scrollIntoView({ block: 'nearest' });
  }
});

for (const tab of detailTabs) {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    for (const t of detailTabs) t.classList.toggle('active', t === tab);
    renderDetail();
  });
}

chrome.devtools.network.onRequestFinished.addListener(onRequest);
chrome.devtools.network.onNavigated.addListener(() => {
  detectOrigin();
  if (!preserveLog) clearAll();
});

// ---- pending / in-flight rows --------------------------------------------
// chrome.devtools.network only fires onRequestFinished — a slow or hung
// request is invisible in our panel while it's alive. pending-capture.js
// injects a fetch/XHR wrapper into the inspected page that tracks live
// requests; we render them here as a separate "in-flight" block below the
// finished rows. When a request completes it drops out of the pending list
// and shows up as a finished row via onRequestFinished.
const pendingRowsEl = document.getElementById('pending-rows');
const pendingRows = new Map(); // pending id -> tr element

function renderPendingRow(entry) {
  const row = el('tr', { className: 'pending-row' });
  row.append(
    el('td', { className: 'sr' }, ''),
    el('td', { className: 'name pending' }, extractUuidFromUrl(entry.url) || entry.url),
    el('td', { className: 'category pending' }, '…'),
    el('td', { className: 'actions' }),
    el('td', null, el('span', { className: 'sbadge pending' }, 'pending')),
    el('td', { className: 'dim' }, entry.method || '—'),
    el('td', { className: 'dim' }, ''),
    el('td', { className: 'mono dim' }, entry.url.replace(/^https?:\/\/[^/]+/, '')),
    el('td', { className: 'dim' }, ''),
    el('td', { className: 'dim' }, ''),
    el('td', { className: 'dim' }, 'in flight')
  );
  return row;
}

function extractUuidFromUrl(url) {
  const m = String(url || '').match(/[0-9a-f]{32}/i);
  return m ? m[0].slice(0, 12) + '…' : null;
}

function updatePending(entries) {
  const currentIds = new Set(entries.map((e) => e.id));

  for (const [id, row] of pendingRows) {
    if (!currentIds.has(id)) {
      row.remove();
      pendingRows.delete(id);
    }
  }
  for (const entry of entries) {
    if (pendingRows.has(entry.id)) continue;
    const row = renderPendingRow(entry);
    pendingRows.set(entry.id, row);
    pendingRowsEl.appendChild(row);
  }
}

startPendingCapture(updatePending);

// ---- focus-hint shortcut --------------------------------------------------
// Neither Chrome nor Firefox lets an extension open or switch DevTools panels
// from a keyboard shortcut. Background writes a session flag when Ctrl+Shift+A
// fires; if this panel is loaded, react by scrolling to newest + pulsing the
// row + focusing the search field. If the flag was set before the panel
// loaded, we still see it on startup (up to a minute old) and react then.
const FOCUS_TARGET = 'ad';
const FOCUS_MAX_AGE_MS = 60_000;

function reactToFocusFlag(value) {
  if (!value || value.target !== FOCUS_TARGET) return;
  if (Date.now() - (value.ts || 0) > FOCUS_MAX_AGE_MS) return;
  listPane.scrollTop = listPane.scrollHeight;
  const last = entries[entries.length - 1];
  if (last && last.rowEl) {
    last.rowEl.classList.add('focus-flash');
    setTimeout(() => {
      if (last.rowEl) last.rowEl.classList.remove('focus-flash');
    }, 900);
  }
  if (filterInput && typeof filterInput.focus === 'function') filterInput.focus();
}

(function watchFocusFlag() {
  const store = (chrome.storage && chrome.storage.session) || (chrome.storage && chrome.storage.local);
  if (!store) return;
  const areaName = chrome.storage.session ? 'session' : 'local';
  store.get(FOCUS_STORAGE_KEY, (result) => {
    if (result && result[FOCUS_STORAGE_KEY]) reactToFocusFlag(result[FOCUS_STORAGE_KEY]);
  });
  if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== areaName) return;
      const change = changes[FOCUS_STORAGE_KEY];
      if (change && change.newValue) reactToFocusFlag(change.newValue);
    });
  }
})();

// Backfill from the browser's own capture. DevTools defers loading panel.html
// until the user first clicks our tab, so any AD chain request fired between
// "DevTools opened" and "user picked AD Network" would otherwise be lost.
// getHAR() reads the same log the built-in Network tab uses, so this closes
// the gap and matches the Network tab's ordering.
function backfillFromHar() {
  try {
    chrome.devtools.network.getHAR((log) => {
      if (!log || !Array.isArray(log.entries)) return;
      const sorted = log.entries.slice().sort((a, b) =>
        (a.startedDateTime || '').localeCompare(b.startedDateTime || '')
      );
      for (const har of sorted) onRequest(har);
    });
  } catch {
    /* getHAR unavailable — live listener still catches everything from now on */
  }
}

// Origin detection, the site list (for designer-host overrides) and the
// metadata cache all have to be in place before the first resolve fires —
// `ready` is what flushResolve() awaits. Backfill runs after, so a warm cache
// paints names on the very first frame instead of after a round-trip.
ready = (async () => {
  await Promise.all([detectOrigin(), loadSiteConfig(), hydrateCache()]);
  watchSiteConfig();
})();

ready.then(backfillFromHar);
