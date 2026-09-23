// Show in-flight AD chain requests in the panel, like the OG Network tab does.
//
// chrome.devtools.network.onRequestFinished (used by network-panel.ts) fires only
// when a request COMPLETES, so a slow / hung / pending request is invisible
// in our panel while it's live. The OG Network tab shows it because it hooks
// into DevTools' start-of-request signal — an API extensions do not get.
//
// Workaround: inject a fetch + XMLHttpRequest wrapper into the inspected
// page via chrome.devtools.inspectedWindow.eval. The wrapper maintains a map
// (PAGE_GLOBALS.pending in config/namespace.ts) keyed by a monotonic id;
// entries appear on request start and disappear on completion or error. The
// panel polls this map ~2× per second via inspectedWindow.eval and reconciles
// a set of "pending" rows against it.
//
// The panel only starts this on an allowed site (network-panel.ts decides),
// and stop() puts the page's own fetch and XMLHttpRequest back. If the page
// has wrapped them again on top of ours, ours is switched off instead (it
// passes every call straight through), so the page's wrapper keeps working.
// The page also retires the wrapper by itself (the same way) when the panel
// has not polled it for STALE_MS: DevTools was closed, so no stop() could run.
//
// Idempotent: the wrapper installs at most once per page context; install()
// on a page that still has it (switched off) switches it back on.

import { evalInPage } from '../inspected';
import { PAGE_GLOBALS } from '../../config/namespace';
import type { PendingEntry } from './types';

const PENDING = JSON.stringify(PAGE_GLOBALS.pending);
const CAPTURE = JSON.stringify(PAGE_GLOBALS.capture);

const POLL_INTERVAL_MS = 500;
/** Unpolled for this long, the wrapper retires itself (see above). */
const STALE_MS = 10_000;

/**
 * The IIFE injected into the inspected page. Runs at page scope, so we cannot
 * reference any module state from here — everything the wrapper needs must be
 * inline. The CHAIN_RE mirrors CHAIN_PATH_RE in src/config/endpoints.ts
 * deliberately: keeping it inline avoids a second inspectedWindow.eval to sync
 * regex state.
 */
export const WRAPPER_SCRIPT = `
(function () {
  var state = window[${CAPTURE}];
  if (state) { state.active = true; state.seen = Date.now(); return true; }
  var XHR = window.XMLHttpRequest;
  var proto = XHR && XHR.prototype;
  state = window[${CAPTURE}] = {
    active: true,
    seen: Date.now(),
    fetch: window.fetch,
    open: proto && proto.open,
    send: proto && proto.send,
    wrapped: {}
  };
  var pending = window[${PENDING}] = new Map();
  var nextId = 1;
  var CHAIN_RE = /\\/rest\\/api\\/automation\\/chain\\//i;
  var xhrInfo = new WeakMap();

  // Put back every original the page has not replaced since, and switch off
  // either way. Also what the panel's stop() runs (UNINSTALL_SCRIPT).
  state.retire = function () {
    state.active = false;
    if (state.wrapped.fetch && window.fetch === state.wrapped.fetch) window.fetch = state.fetch;
    if (proto && state.wrapped.open && proto.open === state.wrapped.open) proto.open = state.open;
    if (proto && state.wrapped.send && proto.send === state.wrapped.send) proto.send = state.send;
    var restored = (!state.wrapped.fetch || window.fetch === state.fetch) &&
      (!state.wrapped.open || (proto.open === state.open && proto.send === state.send));
    if (restored && window[${CAPTURE}] === state) delete window[${CAPTURE}];
    if (window[${PENDING}] === pending) delete window[${PENDING}];
  };
  // Active, unless the panel stopped polling: then retire.
  var live = function () {
    if (state.active && Date.now() - state.seen > ${STALE_MS}) state.retire();
    return state.active;
  };

  if (state.fetch) {
    window.fetch = state.wrapped.fetch = function (input, init) {
      if (!live()) return state.fetch.call(window, input, init);
      var url = '';
      var method = 'GET';
      try {
        url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
        method = (init && init.method) || (input && input.method) || 'GET';
      } catch (e) {}
      if (!CHAIN_RE.test(url)) return state.fetch.call(window, input, init);
      var id = nextId++;
      pending.set(id, { url: url, method: method, startedDateTime: new Date().toISOString() });
      var done = function () { pending.delete(id); };
      var p;
      try { p = state.fetch.call(window, input, init); }
      catch (err) { done(); throw err; }
      return p.then(function (r) { done(); return r; }, function (e) { done(); throw e; });
    };
  }

  if (proto && state.open && state.send) {
    proto.open = state.wrapped.open = function (method, url) {
      if (live()) { try { xhrInfo.set(this, { method: method, url: String(url) }); } catch (e) {} }
      return state.open.apply(this, arguments);
    };
    proto.send = state.wrapped.send = function () {
      var info = live() ? xhrInfo.get(this) : null;
      if (info && CHAIN_RE.test(info.url)) {
        var id = nextId++;
        pending.set(id, { url: info.url, method: info.method || 'GET', startedDateTime: new Date().toISOString() });
        this.addEventListener('loadend', function () { pending.delete(id); });
      }
      return state.send.apply(this, arguments);
    };
  }
  return true;
})();
`;

/** Undoes WRAPPER_SCRIPT (see `retire` there). Runs in the page. */
export const UNINSTALL_SCRIPT = `
(function () {
  var state = window[${CAPTURE}];
  if (state && state.retire) state.retire();
  return true;
})();
`;

/**
 * Serializes the current pending map back to the panel, and tells the
 * wrapper the panel is still there. Runs in the page context; the panel reads
 * its returned value via inspectedWindow.eval.
 */
const READ_SCRIPT =
  `(function () { var s = window[${CAPTURE}]; if (s) s.seen = Date.now(); })(), ` +
  `Array.from(window[${PENDING}] || []).map(function (e) {` +
  '  return { id: e[0], url: e[1].url, method: e[1].method, startedDateTime: e[1].startedDateTime };' +
  '})';

/** Reports the inspected page's in-flight chain requests while started. */
export class PendingCapture {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Bumped per start, so a poll answered after a stop (and restart) is dropped. */
  private generation = 0;

  constructor(private readonly onUpdate: (entries: PendingEntry[]) => void) {}

  get isRunning(): boolean {
    return this.pollTimer !== null;
  }

  /** Wrap the page's fetch/XHR and start polling. A no-op while running. */
  start(): void {
    if (this.pollTimer) return;
    this.generation++;
    this.pollTimer = setInterval(this.poll, POLL_INTERVAL_MS);
    this.install();
    void this.poll();
  }

  /** Stop polling and put the page's own fetch/XHR back. A no-op while stopped. */
  stop(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.generation++;
    void evalInPage(UNINSTALL_SCRIPT);
    this.onUpdate([]);
  }

  /**
   * Wrap again after a navigation: a new document has the page's own fetch.
   * A no-op when not running, or when the wrapper survived.
   */
  install(): void {
    // A null answer means the page blocked the eval, or is not there yet — the
    // poll just reports nothing until a context accepts the wrapper.
    if (this.pollTimer) void evalInPage(WRAPPER_SCRIPT);
  }

  private readonly poll = async (): Promise<void> => {
    const generation = this.generation;
    const result = await evalInPage(READ_SCRIPT);
    // Stopped while waiting, or stopped and started again: this answer is stale.
    if (!this.pollTimer || generation !== this.generation) return;
    this.onUpdate(Array.isArray(result) ? (result as PendingEntry[]) : []);
  };
}
