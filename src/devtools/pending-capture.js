// Show in-flight AD chain requests in the panel, like the OG Network tab does.
//
// chrome.devtools.network.onRequestFinished (used by capture.js) fires only
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

/**
 * The IIFE injected into the inspected page. Runs at page scope, so we cannot
 * reference any module state from here — everything the wrapper needs must be
 * inline. The CHAIN_RE mirrors extract.js CHAIN_PATH_RE deliberately: keeping
 * it inline avoids a second inspectedWindow.eval to sync regex state.
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

/**
 * @typedef {{ id: number, url: string, method: string, startedDateTime: string }} PendingEntry
 * @param {(entries: PendingEntry[]) => void} onUpdate
 * @returns {() => void} disposer that stops the poll + navigation listener
 */
export function startPendingCapture(onUpdate) {
  if (typeof chrome === 'undefined' || !chrome.devtools || !chrome.devtools.inspectedWindow) {
    return () => {};
  }
  const evalFn = chrome.devtools.inspectedWindow.eval.bind(chrome.devtools.inspectedWindow);

  let stopped = false;

  function install() {
    if (stopped) return;
    try {
      evalFn(WRAPPER_SCRIPT, () => {
        /* an exception here means the page context blocked the eval — the
           poll will just return empty until a granted context appears */
      });
    } catch {
      /* inspected window may not be available yet */
    }
  }

  function poll() {
    if (stopped) return;
    try {
      evalFn(READ_SCRIPT, (result, err) => {
        if (stopped) return;
        if (err && (err.isException || err.isError)) {
          onUpdate([]);
          return;
        }
        onUpdate(Array.isArray(result) ? result : []);
      });
    } catch {
      onUpdate([]);
    }
  }

  install();
  const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  poll();

  const onNavigated = () => install();
  if (chrome.devtools.network && chrome.devtools.network.onNavigated) {
    chrome.devtools.network.onNavigated.addListener(onNavigated);
  }

  return function stop() {
    stopped = true;
    clearInterval(pollTimer);
    if (chrome.devtools.network && chrome.devtools.network.onNavigated) {
      chrome.devtools.network.onNavigated.removeListener(onNavigated);
    }
  };
}
