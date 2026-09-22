// Shared content-script bootstrap.
//
// Both designer bundles (ad-content.js, pd-content.js) call this with their own
// feature-starter map. Splitting the entry points means a Page Designer tab
// never even loads the AD-only feature code, and no designer code ships to
// general/published pages at all.

import { startSettingsFeature } from '../features/settings/index';
import { startCurlAutofillFeature } from '../features/curl-autofill/index';
import {
  loadSettings,
  setSetting,
  subscribeSettings,
  type SettingKey,
  type Settings
} from './settings';

/** Starts a feature; may return the function that stops it. */
export type FeatureStarter = () => void | (() => void);

/** Which feature each on/off setting starts. */
export type FeatureStarters = Partial<Record<SettingKey, FeatureStarter>>;

export interface BootstrapOptions {
  /** Consume the AD Network panel's autofill parameter (AD pages only). */
  curlAutofill?: boolean;
}

/** Wire up a designer content script. */
export function bootstrap(featureStarters: FeatureStarters, options: BootstrapOptions = {}): void {
  const activeFeatureStops = new Map<SettingKey, () => void>();
  const featureKeys = Object.keys(featureStarters) as SettingKey[];

  function startFeature(key: SettingKey): void {
    if (activeFeatureStops.has(key)) return;

    const startFeatureFn = featureStarters[key];
    if (!startFeatureFn) return;

    // A feature that throws while starting leaves nothing in
    // activeFeatureStops, so the next settings pass silently retries it and
    // the failure is invisible. Report it loudly — a half-started feature is
    // how the textarea overlay ended up dead-until-toggled once already.
    let cleanup: void | (() => void);
    try {
      cleanup = startFeatureFn();
    } catch (error) {
      console.error(`[belz] feature "${key}" FAILED to start:`, error);
      throw error;
    }
    activeFeatureStops.set(
      key,
      typeof cleanup === 'function' ? cleanup : () => {}
    );
    console.log(`[belz] feature ON  : ${key}`);
  }

  function stopFeature(key: SettingKey): void {
    const cleanup = activeFeatureStops.get(key);
    if (!cleanup) return;

    try {
      cleanup();
    } catch (error) {
      console.error(`Failed stopping feature "${key}":`, error);
    } finally {
      activeFeatureStops.delete(key);
      // Logged because an unexpected stop — from a stale stored setting, say —
      // is otherwise indistinguishable from a feature that never started.
      console.log(`[belz] feature OFF : ${key}`);
    }
  }

  function applyFeatureSettings(settings: Settings, source: string): void {
    console.log(
      `[belz] applying settings (${source}):`,
      featureKeys.map((k) => `${k}=${Boolean(settings[k])}`).join(' ')
    );
    for (const key of featureKeys) {
      try {
        if (settings[key]) {
          startFeature(key);
        } else {
          stopFeature(key);
        }
      } catch (error) {
        console.error(`Failed applying feature "${key}":`, error);
      }
    }
  }

  function init(): void {
    console.log('Extension initializing...');

    applyFeatureSettings(loadSettings(), 'init');
    // Fires immediately with the current snapshot, then again once
    // chrome.storage has been read (and on every later change).
    let firstNotify = true;
    subscribeSettings((settings) => {
      applyFeatureSettings(settings, firstNotify ? 'subscribe' : 'storage');
      firstNotify = false;
    });

    startSettingsFeature({
      getSettings: loadSettings,
      setSetting
    });

    if (options.curlAutofill) {
      startCurlAutofillFeature();
    }

    console.log('Extension initialized successfully');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
