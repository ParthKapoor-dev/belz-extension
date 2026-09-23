// The browser-level keyboard shortcuts (manifest `commands`).
//
//   - open-settings (Alt+Shift+S): the in-page Settings modal lives in the
//     designer content script, so this one is forwarded to the active tab.
//     It exists as a browser command rather than only an in-page keybind
//     because the page never receives some chords — Firefox and Zen both
//     claim Ctrl+, for their own settings — and a command is remappable.
//   - focus-ad-network / focus-pd-inspector (Ctrl+Shift+A / Ctrl+Shift+P):
//     no browser lets an extension open or switch DevTools panels, so these
//     write a session flag (shared/focus-flag.ts) that an open panel reacts to.

import { COMMAND_MESSAGE_KEY } from '../config/namespace';
import { writeFocusFlag } from '../shared/focus-flag';
import { createLogger } from '../shared/logger';
import type { FocusFlag, OpenSettingsMessage } from '../shared/messages';

const log = createLogger('background');

/** The focus command for each panel. */
const FOCUS_TARGETS: Record<string, FocusFlag['target']> = {
  'focus-ad-network': 'ad',
  'focus-pd-inspector': 'pd'
};

export class CommandHandler {
  start(): void {
    chrome.commands?.onCommand?.addListener(this.onCommand);
  }

  stop(): void {
    chrome.commands?.onCommand?.removeListener(this.onCommand);
  }

  readonly onCommand = (command: string): void => {
    if (command === 'open-settings') {
      this.openSettings();
      return;
    }
    const target = FOCUS_TARGETS[command];
    if (target) void writeFocusFlag(target);
  };

  private openSettings(): void {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (!tab || tab.id == null) return;
        const message: OpenSettingsMessage = { [COMMAND_MESSAGE_KEY]: 'open-settings' };
        chrome.tabs.sendMessage(tab.id, message, () => {
          // No receiver on non-designer pages — swallow the expected error.
          void chrome.runtime.lastError;
        });
      });
    } catch (err) {
      log.warn('cannot ask the active tab to open settings:', err);
    }
  }
}
