// Show in-flight AD chain requests in the panel, like the OG Network tab does.
//
// chrome.devtools.network.onRequestFinished (used by network-panel.ts) fires only
// when a request COMPLETES, so a slow / hung / pending request is invisible
// in our panel while it's live. The OG Network tab shows it because it hooks
// into DevTools' start-of-request signal — an API extensions do not get.
//
// Workaround: inject a fetch + XMLHttpRequest wrapper into the inspected
// page via chrome.devtools.inspectedWindow.eval. The wrapper keeps its state,
// including a map of in-flight chain requests keyed by a monotonic id, in one
// page global (PAGE_GLOBALS.capture in config/namespace.ts); entries appear
// on request start and disappear on completion or error. The panel polls that
// map ~2× per second via inspectedWindow.eval and reconciles a set of
// "pending" rows against it.
//
// The panel only starts this on an allowed site (network-panel.ts decides),
// and stop() puts the page's own fetch and XMLHttpRequest back. If the page
// has wrapped them again on top of ours, ours is switched off instead (it
// passes every call straight through), so the page's wrapper keeps working.
// The page also retires the wrapper by itself (the same way) when the panel
// has not polled it for STALE_MS: DevTools was closed, so no stop() could run.
//
// A poll that finds no active wrapper installs it again: a new document (a
// navigation), or a wrapper retired while the panel's timers were throttled
// (a hidden panel can poll as rarely as once a minute). Installing is
// idempotent per page context: on a page that still has a retired wrapper it
// wraps again whatever retiring put back, and switches it on.

import { evalInPage } from '../inspected';
import { PAGE_GLOBALS } from '../../config/namespace';
import type { PendingEntry } from './types';

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
  if (state) { state.revive(); return true; }
  var XHR = window.XMLHttpRequest;
  var proto = XHR && XHR.prototype;
  state = window[${CAPTURE}] = {
    active: true,
    seen: Date.now(),
    fetch: window.fetch,
    open: proto && proto.open,
    send: proto && proto.send,
    wrapped: {},
    pending: new Map()
  };
  var pending = state.pending;
  var nextId = 1;
  var CHAIN_RE = /\\/rest\\/api\\/automation\\/chain\\//i;
  var xhrInfo = new WeakMap();

  // Put back every original the page has not replaced since, and switch off
  // either way. Also what the panel's stop() runs (UNINSTALL_SCRIPT). When
  // everything was put back, the state goes too; otherwise it stays, so
  // revive() can switch the wrapper on again.
  state.retire = function () {
    state.active = false;
    pending.clear();
    if (state.wrapped.fetch && window.fetch === state.wrapped.fetch) window.fetch = state.fetch;
    if (proto && state.wrapped.open && proto.open === state.wrapped.open) proto.open = state.open;
    if (proto && state.wrapped.send && proto.send === state.wrapped.send) proto.send = state.send;
    var restored = (!state.wrapped.fetch || window.fetch === state.fetch) &&
      (!state.wrapped.open || (proto.open === state.open && proto.send === state.send));
    if (restored && window[${CAPTURE}] === state) delete window[${CAPTURE}];
  };
  // Installing again over a retired wrapper: wrap again whatever retire()
  // put back, and switch on.
  state.revive = function () {
    if (state.wrapped.fetch && window.fetch === state.fetch) window.fetch = state.wrapped.fetch;
    if (proto && state.wrapped.open && proto.open === state.open) proto.open = state.wrapped.open;
    if (proto && state.wrapped.send && proto.send === state.send) proto.send = state.wrapped.send;
    state.active = true;
    state.seen = Date.now();
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
 * Tells an active wrapper the panel is still there, and serialises its
 * in-flight requests back to the panel; false when the page has no active
 * wrapper. Runs in the page context; the panel reads its returned value via
 * inspectedWindow.eval.
 */
export const READ_SCRIPT = `
(function () {
  var s = window[${CAPTURE}];
  if (!s || !s.active) return false;
  s.seen = Date.now();
  return Array.from(s.pending).map(function (e) {
    return { id: e[0], url: e[1].url, method: e[1].method, startedDateTime: e[1].startedDateTime };
  });
})();
`;

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
    // A null answer means the page blocked the eval, or is not there yet: the
    // next poll tries again.
    void evalInPage(WRAPPER_SCRIPT);
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

  private readonly poll = async (): Promise<void> => {
    const generation = this.generation;
    const result = await evalInPage(READ_SCRIPT);
    // Stopped while waiting, or stopped and started again: this answer is stale.
    if (!this.pollTimer || generation !== this.generation) return;
    if (Array.isArray(result)) {
      this.onUpdate(result as PendingEntry[]);
      return;
    }
    // No active wrapper (a new document, or it retired itself): wrap again.
    this.onUpdate([]);
    void evalInPage(WRAPPER_SCRIPT);
  };
}
