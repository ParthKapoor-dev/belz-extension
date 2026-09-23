// The manifests scripts/pack.mjs writes for each browser: the permissions they
// ask for are exactly the ones the extension uses. Pure (no build), so fast.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');
const readJson = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const manifest = readJson('manifest.json');
const release = readJson('release.config.json');

// A plain .mjs module without types: imported by path at run time.
const modulePath = path.join(root, 'scripts/manifests.mjs');
const { browserManifest } = (await import(modulePath)) as {
  browserManifest: (m: unknown, target: string, o: { version: string; release: unknown }) => Record<string, any>;
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
});
