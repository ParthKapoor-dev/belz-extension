// Background service worker (Chromium) / background script (Firefox).
//
// Responsibilities:
//
//   1. Reconcile registered content scripts against the user's host list
//      (see content-scripts.ts) on install, on startup, and whenever the list
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

import { isHostsChange } from '../shared/hosts';
import { isPdRelay, type FocusFlag, type OpenSettingsMessage } from '../shared/messages';
import { writeFocusFlag } from '../shared/focus-flag';
import { reconcileContentScripts, seedHostsIfEmpty } from './content-scripts';
import { createLogger } from '../shared/logger';

const log = createLogger('background');

chrome.runtime.onInstalled.addListener(async () => {
  await seedHostsIfEmpty();
  reconcileContentScripts();
});
chrome.runtime.onStartup.addListener(reconcileContentScripts);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (isHostsChange(changes, areaName)) reconcileContentScripts();
});

// ---- PD panel relay -------------------------------------------------------
chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isPdRelay(msg)) return false;

  if (msg.__pdRelay === 'cmd') {
    try {
      chrome.tabs.sendMessage(msg.tabId, msg.payload, (resp: unknown) => {
        sendResponse(chrome.runtime.lastError ? null : resp);
      });
    } catch (err) {
      log.warn('cannot relay to the PD Inspector engine:', err);
      sendResponse(null);
    }
    return true;
  }

  if (msg.__pdRelay === 'open') {
    try {
      chrome.tabs.create({ url: msg.url });
    } catch (err) {
      log.warn('cannot open a tab:', err);
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
          const message: OpenSettingsMessage = { __sdxCommand: 'open-settings' };
          chrome.tabs.sendMessage(tab.id, message, () => {
            // No receiver on non-designer pages — swallow the expected error.
            void chrome.runtime.lastError;
          });
        });
      } catch (err) {
        log.warn('cannot ask the active tab to open settings:', err);
      }
      return;
    }

    const target: FocusFlag['target'] | null =
      command === 'focus-ad-network' ? 'ad'
      : command === 'focus-pd-inspector' ? 'pd'
      : null;
    if (target) writeFocusFlag(target);
  });
}
