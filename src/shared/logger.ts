/*! belz-singleton: shared/logger */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
//
// The extension's only way to write to the console. Every module creates a
// logger named after itself:
//
//   const log = createLogger('json-editor');
//   log.debug('found', n, 'inputs');   // [belz:json-editor] found 3 inputs
//
// Warnings and errors always print. Debug and info messages print only while
// the "Debug Logging" setting is on (settings modal → Advanced). Each
// JavaScript world (content script, background, DevTools panel) has its own
// copy of this module, and each follows the setting through chrome.storage.
import { SETTINGS_STORAGE_KEY } from '../config/storage-keys';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function readDebugFlag(stored: unknown): boolean {
  return Boolean(stored && typeof stored === 'object' && (stored as { debugLogging?: unknown }).debugLogging);
}

/** The "Debug Logging" setting, followed live through chrome.storage. */
class DebugSwitch {
  on = false;

  constructor() {
    // Code injected into the inspected page has no extension APIs.
    const storage = typeof chrome !== 'undefined' ? chrome.storage : undefined;
    if (!storage?.local) return;
    storage.local.get(SETTINGS_STORAGE_KEY, (result: Record<string, unknown>) => {
      this.on = readDebugFlag(result?.[SETTINGS_STORAGE_KEY]);
    });
    storage.onChanged?.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) return;
      this.on = readDebugFlag(changes[SETTINGS_STORAGE_KEY].newValue);
    });
  }
}

const debug = new DebugSwitch();

export function createLogger(scope: string): Logger {
  const prefix = `[belz:${scope}]`;
  return {
    debug: (...args) => { if (debug.on) console.debug(prefix, ...args); },
    info: (...args) => { if (debug.on) console.info(prefix, ...args); },
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args)
  };
}
