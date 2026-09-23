// The per-browser manifests, derived from the root manifest.json template.
// Pure: pack.mjs writes what these return, and tests/build/manifest.test.ts
// checks them without running a build.

/**
 * The manifest for one browser family.
 *
 * @param {Record<string, any>} manifest The root manifest.json.
 * @param {'chrome' | 'firefox'} target
 * @param {{ version: string, release: Record<string, string> }} options
 *   `version` goes into the manifest; `release` is release.config.json.
 * @returns {Record<string, any>}
 */
export function browserManifest(manifest, target, { version, release }) {
  const m = structuredClone(manifest);
  m.version = version;
  if (target === 'chrome') {
    // Chromium: a service worker; no gecko settings.
    if (m.background) delete m.background.scripts;
    delete m.browser_specific_settings;
    return m;
  }
  // Firefox: a background script, plus the gecko id and update URL for
  // AMO signing and auto-update.
  if (m.background) delete m.background.service_worker;
  m.browser_specific_settings = {
    gecko: {
      id: release.firefoxId,
      strict_min_version: '128.0',
      update_url: release.firefoxUpdatesJsonUrl
    }
  };
  return m;
}
