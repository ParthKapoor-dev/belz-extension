// Shared content-script bootstrap.
//
// Both designer bundles (ad-content.js, pd-content.js) call this with their own
// feature-starter map. Splitting the entry points means a Page Designer tab
// never even loads the AD-only feature code, and no designer code ships to
// general/published pages at all.

import { startSettingsFeature } from '../features/settings/index';
import { startCurlAutofillFeature } from '../features/curl-autofill/index';
import { loadSettings, setSetting, subscribeSettings } from './settings';
import type { SettingKey, Settings } from '../../config/settings';
import { createLogger } from '../../shared/logger';

const log = createLogger('bootstrap');

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
      log.error(`feature "${key}" FAILED to start:`, error);
      throw error;
    }
    activeFeatureStops.set(
      key,
      typeof cleanup === 'function' ? cleanup : () => {}
    );
    log.debug(`feature ON  : ${key}`);
  }

  function stopFeature(key: SettingKey): void {
    const cleanup = activeFeatureStops.get(key);
    if (!cleanup) return;

    try {
      cleanup();
    } catch (error) {
      log.error(`Failed stopping feature "${key}":`, error);
    } finally {
      activeFeatureStops.delete(key);
      // Logged because an unexpected stop — from a stale stored setting, say —
      // is otherwise indistinguishable from a feature that never started.
      log.debug(`feature OFF : ${key}`);
    }
  }

  function applyFeatureSettings(settings: Settings, source: string): void {
    log.debug(
      `applying settings (${source}):`,
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
        log.error(`Failed applying feature "${key}":`, error);
      }
    }
  }

  function init(): void {
    log.debug('Extension initializing...');

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

    log.debug('Extension initialized successfully');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
