// The focus-hint keyboard shortcuts (Ctrl+Shift+A / Ctrl+Shift+P), panel side.
//
// No browser lets an extension open or switch DevTools panels. So the shortcut
// makes the background write a flag to storage (see src/background/index.ts),
// and the targeted panel, if it is loaded, reacts to it. A flag written before
// the panel loaded is still honoured on startup if it is recent enough.

import { FOCUS_STORAGE_KEY } from '../config/storage-keys';
import type { FocusFlag } from '../shared/messages';

/** A flag older than this is ignored: the shortcut was for an earlier moment. */
const FOCUS_MAX_AGE_MS = 60_000;

/** Call `onFocus` whenever the focus shortcut targets this panel. */
export function watchFocusFlag(target: FocusFlag['target'], onFocus: () => void): void {
  // Session storage, so the flag does not outlive the browser session; local
  // storage on browsers without it.
  const areaName = chrome.storage.session ? 'session' : 'local';
  const store = chrome.storage.session || chrome.storage.local;

  const react = (value: unknown) => {
    const flag = value as Partial<FocusFlag> | null | undefined;
    if (!flag || flag.target !== target) return;
    if (Date.now() - (flag.ts || 0) > FOCUS_MAX_AGE_MS) return;
    onFocus();
  };

  store.get(FOCUS_STORAGE_KEY, (result: Record<string, unknown>) => react(result[FOCUS_STORAGE_KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== areaName) return;
    const change = changes[FOCUS_STORAGE_KEY];
    if (change && change.newValue) react(change.newValue);
  });
}
