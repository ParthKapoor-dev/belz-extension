// Shared content-script bootstrap.
//
// Both designer bundles (ad-content.ts, pd-content.ts) call this with their
// own features, keyed by the setting that switches each on. Splitting the
// entry points means a Page Designer tab never even loads the AD-only feature
// code, and no designer code ships to general/published pages at all.

import { SettingsLauncher } from '../features/settings/index';
import { settings } from './settings';
import type { Feature } from './feature';
import type { SettingKey, Settings } from '../../config/settings';
import { createLogger } from '../../shared/logger';

const log = createLogger('bootstrap');

/** The features of one designer, keyed by the on/off setting of each. */
export type Features = Partial<Record<SettingKey, Feature>>;

/**
 * Starts and stops each feature as its setting changes, for the life of the
 * page.
 */
class FeatureSwitchboard {
  private readonly running = new Set<SettingKey>();

  constructor(private readonly features: Features) {}

  apply(current: Settings, source: string): void {
    const keys = Object.keys(this.features) as SettingKey[];
    log.debug(`applying settings (${source}):`, keys.map((k) => `${k}=${Boolean(current[k])}`).join(' '));
    for (const key of keys) {
      if (current[key]) this.start(key);
      else this.stop(key);
    }
  }

  /** Stop every running feature. */
  stopAll(): void {
    for (const key of [...this.running]) this.stop(key);
  }

  private start(key: SettingKey): void {
    const feature = this.features[key];
    if (!feature || this.running.has(key)) return;
    // A feature that throws while starting is not marked running, so the next
    // settings pass retries it. Report it loudly: a half-started feature is
    // how the textarea overlay ended up dead-until-toggled once already.
    try {
      feature.start();
    } catch (error) {
      log.error(`feature "${key}" FAILED to start:`, error);
      return;
    }
    this.running.add(key);
    log.debug(`feature ON  : ${key}`);
  }

  private stop(key: SettingKey): void {
    const feature = this.features[key];
    if (!feature || !this.running.has(key)) return;
    try {
      feature.stop();
    } catch (error) {
      log.error(`Failed stopping feature "${key}":`, error);
    } finally {
      this.running.delete(key);
      // Logged because an unexpected stop — from a stale stored setting, say —
      // is otherwise indistinguishable from a feature that never started.
      log.debug(`feature OFF : ${key}`);
    }
  }
}

/**
 * Wire up a designer content script. Returns the teardown: it stops every
 * feature and the settings launcher and removes every listener. A page never
 * calls it (the content script lives as long as the page); tests do, so no
 * bootstrap outlives its test.
 */
export function bootstrap(features: Features): () => void {
  const switchboard = new FeatureSwitchboard(features);
  const launcher = new SettingsLauncher();
  let unsubscribe: (() => void) | null = null;

  function init(): void {
    log.debug('Extension initializing...');

    // Fires immediately with the current snapshot, then again once
    // chrome.storage has been read (and on every later change).
    let first = true;
    unsubscribe = settings.subscribe((current) => {
      switchboard.apply(current, first ? 'init' : 'storage');
      first = false;
    });

    // Always on: the way back to turning features on.
    launcher.start();

    log.debug('Extension initialized successfully');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return () => {
    document.removeEventListener('DOMContentLoaded', init);
    unsubscribe?.();
    unsubscribe = null;
    switchboard.stopAll();
    launcher.stop();
  };
}
