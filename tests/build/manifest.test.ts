// The manifests scripts/pack.mjs writes for each browser: the permissions they
// ask for are exactly the ones the extension uses. Pure (no build), so fast.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');
const readJson = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const manifest = readJson('manifest.json');
const release = readJson('scripts/release.config.json');

// A plain .mjs module without types: imported by path at run time.
const modulePath = path.join(root, 'scripts/manifests.mjs');
const { browserManifest } = (await import(modulePath)) as {
  browserManifest: (
    m: unknown,
    target: string,
    o: { version: string; release: unknown; store?: boolean }
  ) => Record<string, any>;
};

describe.each(['chrome', 'firefox'])('the %s manifest', (target) => {
  const m = browserManifest(manifest, target, { version: '9.9.9', release });

  test('asks for storage and scripting only: no activeTab, tabs or static host access', () => {
    expect([...m.permissions].sort()).toEqual(['scripting', 'storage']);
    expect(m.host_permissions).toBeUndefined();
  });

  test('can only ever be granted https sites, one at a time from the options page', () => {
    expect(m.optional_host_permissions).toEqual(['https://*/*']);
  });

  test('exposes only the content-script modules to web pages, on https pages', () => {
    expect(m.web_accessible_resources).toEqual([{ resources: ['dist/modules/*'], matches: ['https://*/*'] }]);
  });

  test('has an icon at every size, and every icon file exists (under assets/ in the repo)', () => {
    expect(Object.keys(m.icons).sort()).toEqual(['128', '16', '32', '48']);
    for (const file of Object.values(m.icons) as string[]) expect(existsSync(path.join(root, 'assets', file))).toBe(true);
  });

  test('carries the release version', () => {
    expect(m.version).toBe('9.9.9');
  });
});

describe('per-browser differences', () => {
  test('Chromium: a service worker, no gecko settings', () => {
    const m = browserManifest(manifest, 'chrome', { version: '1.0.0', release });
    expect(m.background).toEqual({ service_worker: 'dist/background.js' });
    expect(m.browser_specific_settings).toBeUndefined();
  });

  test('Firefox: a background script, the gecko id, Firefox 128 or newer', () => {
    const m = browserManifest(manifest, 'firefox', { version: '1.0.0', release });
    expect(m.background).toEqual({ scripts: ['dist/background.js'] });
    expect(m.browser_specific_settings.gecko.id).toBe(release.firefoxId);
    expect(m.browser_specific_settings.gecko.strict_min_version).toBe('128.0');
  });

  test('Firefox: declares that it collects no data, as AMO requires of a new add-on', () => {
    const m = browserManifest(manifest, 'firefox', { version: '1.0.0', release });
    expect(m.browser_specific_settings.gecko.data_collection_permissions).toEqual({ required: ['none'] });
  });

  test('Firefox: auto-updates from the configured updates.json', () => {
    const m = browserManifest(manifest, 'firefox', { version: '1.0.0', release });
    expect(m.browser_specific_settings.gecko.update_url).toBe(release.firefoxUpdatesJsonUrl);
  });
});

describe('the Chrome Web Store public key (chromePublicKey)', () => {
  const withKey = { ...release, chromePublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest' };

  test('is the local Chromium tree\'s `key` when configured, so an unpacked build has the store ID', () => {
    const m = browserManifest(manifest, 'chrome', { version: '1.0.0', release: withKey });
    expect(m.key).toBe(withKey.chromePublicKey);
  });

  test('is left out of the Web Store package, which the store would reject', () => {
    const m = browserManifest(manifest, 'chrome', { version: '1.0.0', release: withKey, store: true });
    expect('key' in m).toBe(false);
  });

  test('is never in the Firefox manifest', () => {
    const m = browserManifest(manifest, 'firefox', { version: '1.0.0', release: withKey });
    expect('key' in m).toBe(false);
  });

  test('when empty, no tree carries a `key`', () => {
    const m = browserManifest(manifest, 'chrome', { version: '1.0.0', release: { ...release, chromePublicKey: '' } });
    expect('key' in m).toBe(false);
  });

  test('is a string in scripts/release.config.json, and the root manifest has no `key` of its own', () => {
    expect(typeof release.chromePublicKey).toBe('string');
    expect('key' in manifest).toBe(false);
  });
});
