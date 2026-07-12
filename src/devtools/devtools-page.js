// Registers the DevTools panels — "AD Network" and "PD Inspector".
//
// This runs in the devtools-page context (one per open DevTools window). It
// only registers the panels; all logic lives in panel.js / panel-pd.js, which
// the browser loads when the user first opens each panel tab.
//
// The panel pages (`panel.html`, `panel-pd.html`) live at the extension root
// (not under dist/): Chromium resolves these paths relative to the extension
// root, but Firefox resolves them relative to the devtools page — a
// `dist/panel.html` would become `dist/dist/panel.html` there and load blank.
//
// Panels are gated to the user's allowed-sites list. Without this check the
// AD Network + PD Inspector tabs would appear in DevTools on every site
// (YouTube, chrome://newtab, etc.) because `devtools_page` runs per-DevTools-
// window, not per-host. We check on init and again on navigation so panels
// appear the moment the user reaches an allowed site.

import { HOSTS_STORAGE_KEY } from '../config/storage-keys.js';

const PANELS = [
  { title: 'AD Network', page: 'panel.html' },
  { title: 'PD Inspector', page: 'panel-pd.html' }
];

const created = new Set(); // titles already registered — panels are idempotent per DevTools session

function currentHost() {
  return new Promise((resolve) => {
    try {
      chrome.devtools.inspectedWindow.eval('location.host', (result, err) => {
        if (err) resolve('');
        else resolve(typeof result === 'string' ? result.toLowerCase() : '');
      });
    } catch {
      resolve('');
    }
  });
}

async function allowedHosts() {
  try {
    const result = await chrome.storage.local.get(HOSTS_STORAGE_KEY);
    const raw = result && result[HOSTS_STORAGE_KEY];
    if (!raw || !Array.isArray(raw.hosts)) return new Set();
    return new Set(
      raw.hosts
        .filter((h) => h && typeof h.host === 'string' && h.enabled !== false)
        .map((h) => h.host.toLowerCase())
    );
  } catch {
    return new Set();
  }
}

async function tryCreatePanels() {
  if (created.size === PANELS.length) return;
  const [host, allowed] = await Promise.all([currentHost(), allowedHosts()]);
  if (!host || !allowed.has(host)) return;
  for (const { title, page } of PANELS) {
    if (created.has(title)) continue;
    created.add(title);
    chrome.devtools.panels.create(title, '', page, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        created.delete(title);
        console.error(`[${title}] panel registration failed:`, chrome.runtime.lastError);
      }
    });
  }
}

tryCreatePanels();

// If DevTools was opened on a non-allowed page and the user then navigates the
// same tab to an allowed host, create the panels now — this is the only path
// to a panel-visible state without closing and reopening DevTools.
if (chrome.devtools.network && chrome.devtools.network.onNavigated) {
  chrome.devtools.network.onNavigated.addListener(() => tryCreatePanels());
}

// Same for a host that gets added to the allowed list via the options page
// while DevTools is already open.
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[HOSTS_STORAGE_KEY]) tryCreatePanels();
  });
}
