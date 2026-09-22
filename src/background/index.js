// Background service worker (Chromium) / background script (Firefox).
//
// Responsibilities:
//
//   1. Reconcile registered content scripts against the user's host list
//      (see content-scripts.js) on install, on startup, and whenever the list
//      changes.
//
//   2. Relay panel-pd messages so the PD Inspector DevTools panel can reach
//      the inspected page's content script. Firefox does not expose
//      chrome.tabs to DevTools panel scripts, so the panel routes through
//      here.
//
//   3. Handle the focus-hint keyboard shortcuts. Extensions cannot open or
//      switch DevTools panels, so the shortcut writes a session flag that
//      the AD Network and PD Inspector panels react to when they're open.

import { FOCUS_STORAGE_KEY } from '../config/storage-keys.js';
import { isHostsChange } from '../shared/hosts.js';
import { reconcileContentScripts, seedHostsIfEmpty } from './content-scripts.js';

chrome.runtime.onInstalled.addListener(async () => {
  await seedHostsIfEmpty();
  reconcileContentScripts();
});
chrome.runtime.onStartup.addListener(reconcileContentScripts);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (isHostsChange(changes, areaName)) reconcileContentScripts();
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
    // Settings is an in-page modal, so this one goes straight to the content
    // script. It exists as a browser command rather than only an in-page
    // keybind because the page never receives some chords — Firefox and Zen
    // both claim Ctrl+, for their own settings, so the in-page handler could
    // never fire there. A command is also user-remappable, which an in-page
    // listener is not.
    if (command === 'open-settings') {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs && tabs[0];
          if (!tab || tab.id == null) return;
          chrome.tabs.sendMessage(tab.id, { __sdxCommand: 'open-settings' }, () => {
            // No receiver on non-designer pages — swallow the expected error.
            void chrome.runtime.lastError;
          });
        });
      } catch {
        /* tabs unavailable */
      }
      return;
    }

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
