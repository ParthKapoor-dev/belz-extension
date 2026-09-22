/*! belz-singleton: designer/core/settings */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
import { SETTINGS_STORAGE_KEY } from '../../config/storage-keys';
import {
  DEFAULT_SETTINGS,
  isSettingKey,
  sanitizeSetting,
  sanitizeSettings,
  type Settings
} from '../../config/settings';
import { createLogger } from '../../shared/logger';

const log = createLogger('settings');

// The schema (keys, defaults, valid values) lives in config/settings.ts.
// This module holds the live copy for the page and keeps it in step with
// chrome.storage.

export type SettingsListener = (settings: Settings) => void;

const settingListeners = new Set<SettingsListener>();
let cachedSettings: Settings = { ...DEFAULT_SETTINGS };

// chrome.storage.local is the durable, extension-wide store: the content
// scripts on every designer host share one live view of it.
function chromeStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
    ? chrome.storage.local
    : null;
}

function callListener(listener: SettingsListener, snapshot: Settings): void {
  try {
    listener(snapshot);
  } catch (error) {
    log.error('Settings listener failed:', error);
  }
}

function notifySettingsChange() {
  const snapshot = { ...cachedSettings };
  for (const listener of settingListeners) callListener(listener, snapshot);
}

function applyStoredValue(stored: unknown): void {
  cachedSettings = sanitizeSettings(stored);
  notifySettingsChange();
}

function hydrate() {
  const storage = chromeStorage();
  if (!storage) {
    // No chrome.storage — likely a stale test harness. The defaults stand.
    return;
  }
  storage.get(SETTINGS_STORAGE_KEY, (result: Record<string, unknown>) => {
    const stored = result && result[SETTINGS_STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      applyStoredValue(stored);
      return;
    }
    // Nothing stored yet (first run): the defaults stand.
    notifySettingsChange();
  });

  if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
    chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) return;
      const next = changes[SETTINGS_STORAGE_KEY].newValue;
      if (!next || typeof next !== 'object') return;
      cachedSettings = sanitizeSettings(next);
      notifySettingsChange();
    });
  }
}

hydrate();

function writeToStorage(settings: Settings): void {
  const storage = chromeStorage();
  if (!storage) return;
  storage.set({ [SETTINGS_STORAGE_KEY]: settings });
}

export function loadSettings(): Settings {
  return { ...cachedSettings };
}

export function saveSettings(nextSettings: unknown): Settings {
  cachedSettings = sanitizeSettings(nextSettings);
  writeToStorage(cachedSettings);
  notifySettingsChange();
  return { ...cachedSettings };
}

export function setSetting(key: string, value: unknown): Settings {
  if (!isSettingKey(key)) {
    return { ...cachedSettings };
  }

  const normalizedValue = sanitizeSetting(key, value);
  if (cachedSettings[key] === normalizedValue) {
    return { ...cachedSettings };
  }

  return saveSettings({
    ...cachedSettings,
    [key]: normalizedValue
  });
}

export function subscribeSettings(listener: SettingsListener): () => void {
  settingListeners.add(listener);
  // Guarded like every later notification: a subscriber that throws on its
  // first call must not throw out of subscribeSettings() into the caller.
  callListener(listener, loadSettings());

  return () => {
    settingListeners.delete(listener);
  };
}
