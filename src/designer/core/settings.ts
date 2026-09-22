/*! belz-singleton: designer/core/settings */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
//
// The page's live copy of the user's settings. The schema (keys, defaults,
// valid values) lives in config/settings.ts; this module keeps a copy in
// memory, tells subscribers when it changes, and keeps it in step with
// storage. Every value that goes in is sanitised against the schema.
import { SETTINGS_STORAGE_KEY } from '../../config/storage-keys';
import {
  DEFAULT_SETTINGS,
  isSettingKey,
  sanitizeSetting,
  sanitizeSettings,
  type Settings
} from '../../config/settings';
import { createLogger } from '../../shared/logger';

const log = createLogger('settings-store');

export type SettingsListener = (settings: Settings) => void;

/** Where settings are persisted. Injected, so tests can pass an in-memory one. */
export interface SettingsStorage {
  /** The stored value, or undefined if nothing is stored yet. */
  read(): Promise<unknown>;
  write(settings: Settings): void;
  /** Calls `onChange` with the new stored value whenever another page changes it. */
  watch(onChange: (stored: unknown) => void): void;
}

export class SettingsStore {
  private current: Settings = { ...DEFAULT_SETTINGS };
  private readonly listeners = new Set<SettingsListener>();

  /** `storage` null: defaults only, nothing persisted. */
  constructor(private readonly storage: SettingsStorage | null) {
    if (!storage) return;
    storage.watch((stored) => {
      if (stored && typeof stored === 'object') this.apply(stored);
    });
    storage.read().then((stored) => {
      // Nothing stored yet (first run): the defaults stand, but subscribers
      // still hear that loading finished.
      this.apply(stored && typeof stored === 'object' ? stored : this.current);
    }, (error) => log.error('reading settings failed:', error));
  }

  /** A copy of the current settings. */
  get(): Settings {
    return { ...this.current };
  }

  /** Change one setting. Unknown keys and unchanged values are ignored. */
  set(key: string, value: unknown): Settings {
    if (!isSettingKey(key)) return this.get();
    const next = sanitizeSetting(key, value);
    if (this.current[key] === next) return this.get();
    return this.replace({ ...this.current, [key]: next });
  }

  /** Replace every setting at once, then persist and notify. */
  replace(next: unknown): Settings {
    this.current = sanitizeSettings(next);
    this.storage?.write(this.current);
    this.notify();
    return this.get();
  }

  /**
   * Calls `listener` now with the current settings, then after every change.
   * Returns the function that unsubscribes it.
   */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    // Guarded like every later notification: a subscriber that throws on its
    // first call must not throw out of subscribe() into the caller.
    this.call(listener, this.get());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private apply(stored: unknown): void {
    this.current = sanitizeSettings(stored);
    this.notify();
  }

  private notify(): void {
    const snapshot = this.get();
    for (const listener of this.listeners) this.call(listener, snapshot);
  }

  private call(listener: SettingsListener, snapshot: Settings): void {
    try {
      listener(snapshot);
    } catch (error) {
      log.error('Settings listener failed:', error);
    }
  }
}

/**
 * chrome.storage.local: the durable, extension-wide store. The content
 * scripts on every designer host share one live view of it. Null when the
 * extension API is not available.
 */
export function chromeSettingsStorage(): SettingsStorage | null {
  const storage = typeof chrome !== 'undefined' ? chrome.storage : undefined;
  if (!storage?.local) return null;
  return {
    read: async () => (await storage.local.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY],
    write: (settings) => {
      storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
    },
    watch: (onChange) => {
      storage.onChanged?.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[SETTINGS_STORAGE_KEY]) {
          onChange(changes[SETTINGS_STORAGE_KEY].newValue);
        }
      });
    }
  };
}

/** The settings of this page. */
export const settings = new SettingsStore(chromeSettingsStorage());
