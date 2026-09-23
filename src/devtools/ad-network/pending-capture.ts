// Show in-flight AD chain requests in the panel, like the OG Network tab does.
//
// chrome.devtools.network.onRequestFinished (used by network-panel.ts) fires only
// when a request COMPLETES, so a slow / hung / pending request is invisible
// in our panel while it's live. The OG Network tab shows it because it hooks
// into DevTools' start-of-request signal — an API extensions do not get.
//
// Workaround: inject a fetch + XMLHttpRequest wrapper into the inspected
// page via chrome.devtools.inspectedWindow.eval. The wrapper maintains a
// `window.__belzADPending` map keyed by a monotonic id; entries appear on
// request start and disappear on completion or error. The panel polls this
// map ~2× per second via inspectedWindow.eval and reconciles a set of
// "pending" rows against it.
//
// Idempotent: the wrapper installs at most once per page context. On
// navigation (chrome.devtools.network.onNavigated) we call install() again,
// which is a no-op if a previous install survived the navigation or a fresh
// install if the page context was reset.

import { evalInPage } from '../inspected';
import type { PendingEntry } from './types';

/**
 * The IIFE injected into the inspected page. Runs at page scope, so we cannot
 * reference any module state from here — everything the wrapper needs must be
 * inline. The CHAIN_RE mirrors CHAIN_PATH_RE in src/config/endpoints.ts
 * deliberately: keeping it inline avoids a second inspectedWindow.eval to sync
 * regex state.
 */
const WRAPPER_SCRIPT = `
(function () {
  if (window.__belzADPendingInstalled) return true;
  window.__belzADPendingInstalled = true;
  window.__belzADPending = new Map();
  var nextId = 1;
  var CHAIN_RE = /\\/rest\\/api\\/automation\\/chain\\//i;

  var _fetch = window.fetch && window.fetch.bind(window);
  if (_fetch) {
    window.fetch = function (input, init) {
      var url = '';
      var method = 'GET';
      try {
        url = typeof input === 'string' ? input : (input && input.url) || '';
        method = (init && init.method) || (input && input.method) || 'GET';
      } catch (e) {}
      if (!CHAIN_RE.test(url)) return _fetch(input, init);
      var id = nextId++;
      var startedDateTime = new Date().toISOString();
      window.__belzADPending.set(id, { url: url, method: method, startedDateTime: startedDateTime });
      var done = function () { window.__belzADPending.delete(id); };
      var p;
      try { p = _fetch(input, init); }
      catch (err) { done(); throw err; }
      return p.then(function (r) { done(); return r; }, function (e) { done(); throw e; });
    };
  }

  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var _open = XHR.prototype.open;
    var _send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      try { this.__belzURL = url; this.__belzMethod = method; } catch (e) {}
      return _open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      var url = this.__belzURL;
      if (typeof url === 'string' && CHAIN_RE.test(url)) {
        var id = nextId++;
        var startedDateTime = new Date().toISOString();
        window.__belzADPending.set(id, {
          url: url,
          method: this.__belzMethod || 'GET',
          startedDateTime: startedDateTime
        });
        var done = function () { window.__belzADPending.delete(id); };
        this.addEventListener('loadend', done);
      }
      return _send.apply(this, arguments);
    };
  }
  return true;
})();
`;

/**
 * Serializes the current pending map back to the panel. Runs in the page
 * context; the panel reads its returned value via inspectedWindow.eval.
 */
const READ_SCRIPT =
  'Array.from(window.__belzADPending || []).map(function (e) {' +
  '  return { id: e[0], url: e[1].url, method: e[1].method, startedDateTime: e[1].startedDateTime };' +
  '})';

const POLL_INTERVAL_MS = 500;

/** Reports the inspected page's in-flight chain requests while started. */
export class PendingCapture {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Bumped per start, so a poll answered after a stop (and restart) is dropped. */
  private generation = 0;

  constructor(private readonly onUpdate: (entries: PendingEntry[]) => void) {}

  start(): void {
    if (this.pollTimer) return;
    this.generation++;
    // The timer first: install() and poll() only act while started.
    this.pollTimer = setInterval(this.poll, POLL_INTERVAL_MS);
    this.install();
    this.poll();
    chrome.devtools.network.onNavigated.addListener(this.install);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.generation++;
    chrome.devtools.network.onNavigated.removeListener(this.install);
  }

  // A null answer means the page blocked the eval, or is not there yet — the
  // poll just reports nothing until a context accepts the wrapper.
  private readonly install = (): void => {
    if (this.pollTimer) void evalInPage(WRAPPER_SCRIPT);
  };

  private readonly poll = async (): Promise<void> => {
    const generation = this.generation;
    const result = await evalInPage(READ_SCRIPT);
    // Stopped while waiting, or stopped and started again: this answer is stale.
    if (!this.pollTimer || generation !== this.generation) return;
    this.onUpdate(Array.isArray(result) ? (result as PendingEntry[]) : []);
  };
}
