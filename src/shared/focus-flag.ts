// The focus-hint keyboard shortcuts (Ctrl+Shift+A / Ctrl+Shift+P).
//
// No browser lets an extension open or switch DevTools panels. So the
// background writes a flag to storage when the shortcut fires, and the
// targeted panel, if it is loaded, reacts to it. A flag written before the
// panel loaded is still honoured on startup if it is recent enough.

import { FOCUS_STORAGE_KEY } from '../config/storage-keys';
import type { FocusFlag } from './messages';
import { createLogger } from './logger';

const log = createLogger('focus-flag');

/** A flag older than this is ignored: the shortcut was for an earlier moment. */
const FOCUS_MAX_AGE_MS = 60_000;

/**
 * Session storage, so the flag does not outlive the browser session; local
 * storage on browsers without it (older Firefox).
 */
function flagArea(): { name: 'session' | 'local'; store: chrome.storage.StorageArea } {
  return chrome.storage.session
    ? { name: 'session', store: chrome.storage.session }
    : { name: 'local', store: chrome.storage.local };
}

/** Background side: ask the `target` panel to focus itself. Never rejects. */
export async function writeFocusFlag(target: FocusFlag['target']): Promise<void> {
  const value: FocusFlag = { target, ts: Date.now() };
  try {
    await flagArea().store.set({ [FOCUS_STORAGE_KEY]: value });
  } catch (err) {
    log.warn('cannot write the panel focus flag:', err);
  }
}

/**
 * Panel side: call `onFocus` whenever the focus shortcut targets this panel.
 * Returns the function that stops watching.
 */
export function watchFocusFlag(target: FocusFlag['target'], onFocus: () => void): () => void {
  const { name, store } = flagArea();
  let active = true;

  const react = (value: unknown) => {
    const flag = value as Partial<FocusFlag> | null | undefined;
    if (!active || !flag || flag.target !== target) return;
    if (Date.now() - (flag.ts || 0) > FOCUS_MAX_AGE_MS) return;
    onFocus();
  };

  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== name) return;
    const change = changes[FOCUS_STORAGE_KEY];
    if (change && change.newValue) react(change.newValue);
  };

  store.get(FOCUS_STORAGE_KEY, (result: Record<string, unknown>) => react(result[FOCUS_STORAGE_KEY]));
  chrome.storage.onChanged.addListener(onChanged);
  return () => {
    active = false; // also silences the initial read, if it has not answered yet
    chrome.storage.onChanged.removeListener(onChanged);
  };
}
