// Background service worker (Chromium) / background script (Firefox).
//
// Responsibilities:
//
//   1. Reconcile registered content scripts against the user's host list. The
//      list lives in chrome.storage.local under sdExtensionHostsV1 and is
//      edited via the options page. On startup and whenever the list changes,
//      we call chrome.scripting.registerContentScripts / unregister so the
//      real world matches storage.
//
//   2. Relay panel-pd messages so the PD Inspector DevTools panel can reach
//      the inspected page's content script. Firefox does not expose
//      chrome.tabs to DevTools panel scripts, so the panel routes through
//      here.
//
//   3. Handle the focus-hint keyboard shortcuts. Extensions cannot open or
//      switch DevTools panels, so the shortcut writes a session flag that
//      panel.js / panel-pd.js react to when they're open.

const HOSTS_STORAGE_KEY = 'sdExtensionHostsV1';
const FOCUS_STORAGE_KEY = 'sdExtensionPanelFocusV1';

// Each granted host gets three registrations — AD, PD, PD-Inspector — matching
// the routes the old static manifest declared.
const CONTENT_SCRIPT_TEMPLATES = [
  { key: 'ad', path: '/automation-designer/*', js: 'dist/ad-content.js' },
  { key: 'pd', path: '/ui-designer/*', js: 'dist/pd-content.js' },
  { key: 'pdi', path: '/pages/*', js: 'dist/pd-inspector.js' }
];

function idFor(host, template) {
  return `${template.key}-${host}`;
}

function scriptForHost(host, template) {
  return {
    id: idFor(host, template),
    matches: [`https://${host}${template.path}`],
    js: [template.js],
    runAt: 'document_idle',
    world: 'ISOLATED'
  };
}

async function currentHosts() {
  const result = await chrome.storage.local.get(HOSTS_STORAGE_KEY);
  const raw = result && result[HOSTS_STORAGE_KEY];
  if (!raw || !Array.isArray(raw.hosts)) return [];
  return raw.hosts.filter((h) => h && typeof h.host === 'string' && h.enabled !== false);
}

async function currentRegistrations() {
  try {
    return await chrome.scripting.getRegisteredContentScripts();
  } catch {
    return [];
  }
}

async function reconcileContentScripts() {
  const enabled = await currentHosts();
  const wantIds = new Set();
  const want = [];
  for (const entry of enabled) {
    for (const tpl of CONTENT_SCRIPT_TEMPLATES) {
      const script = scriptForHost(entry.host, tpl);
      want.push(script);
      wantIds.add(script.id);
    }
  }

  const registered = await currentRegistrations();
  const registeredIds = new Set(registered.map((s) => s.id));

  const toRemove = registered
    .map((s) => s.id)
    .filter((id) => !wantIds.has(id));
  const toAdd = want.filter((s) => !registeredIds.has(s.id));
  const toUpdate = want.filter((s) => registeredIds.has(s.id));

  try {
    if (toRemove.length) {
      await chrome.scripting.unregisterContentScripts({ ids: toRemove });
    }
    if (toAdd.length) {
      await chrome.scripting.registerContentScripts(toAdd);
    }
    if (toUpdate.length) {
      // Update covers the case where the manifest paths / template shape
      // changed under an existing host (e.g. new content script variant).
      await chrome.scripting.updateContentScripts(toUpdate);
    }
  } catch (err) {
    console.error('[belz-extension] content script reconcile failed:', err);
  }
}

chrome.runtime.onInstalled.addListener(reconcileContentScripts);
chrome.runtime.onStartup.addListener(reconcileContentScripts);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[HOSTS_STORAGE_KEY]) {
    reconcileContentScripts();
  }
});

// ---- PD panel relay -------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.__pdRelay) return false;

  if (msg.__pdRelay === 'cmd') {
    try {
      chrome.tabs.sendMessage(msg.tabId, msg.payload, (resp) => {
        sendResponse(chrome.runtime.lastError ? null : resp);
      });
    } catch {
      sendResponse(null);
    }
    return true;
  }

  if (msg.__pdRelay === 'open') {
    try {
      chrome.tabs.create({ url: msg.url });
    } catch {
      /* ignore */
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// ---- focus-hint shortcuts -------------------------------------------------
// chrome.commands cannot open or switch DevTools panels (no browser exposes
// that API). Instead we write a session-scoped flag that a live DevTools
// panel picks up via chrome.storage.onChanged to scroll+pulse the newest
// entry. If no panel is listening, the shortcut still records the intent —
// the panel reads the flag when it opens.
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    const target =
      command === 'focus-ad-network' ? 'ad'
      : command === 'focus-pd-inspector' ? 'pd'
      : null;
    if (!target) return;
    const value = { target, ts: Date.now() };
    // Prefer session storage so the flag doesn't survive browser restart.
    // Fall back to local storage if session is unavailable (older Firefox).
    const store = chrome.storage.session || chrome.storage.local;
    store.set({ [FOCUS_STORAGE_KEY]: value });
  });
}
