// The per-browser manifests, derived from the root manifest.json template.
// Pure: pack.mjs writes what these return, and tests/build/manifest.test.ts
// checks them without running a build.

/**
 * The manifest for one browser family.
 *
 * @param {Record<string, any>} manifest The root manifest.json.
 * @param {'chrome' | 'firefox'} target
 * @param {{ version: string, release: Record<string, string>, store?: boolean }} options
 *   `version` goes into the manifest; `release` is scripts/release.config.json.
 *   `store` (Chromium only): the tree is the Chrome Web Store package, which
 *   must not carry a `key`.
 * @returns {Record<string, any>}
 */
export function browserManifest(manifest, target, { version, release, store = false }) {
  const m = structuredClone(manifest);
  m.version = version;
  if (target === 'chrome') {
    // Chromium: a service worker; no gecko settings.
    if (m.background) delete m.background.scripts;
    delete m.browser_specific_settings;
    // The Web Store item's public key pins an unpacked build to the store
    // item's ID. The store rejects a package that carries one, so only a local
    // tree gets it.
    if (!store && release.chromePublicKey) m.key = release.chromePublicKey;
    return m;
  }
  // Firefox: a background script, plus the gecko id and update URL for
  // AMO signing and auto-update, and the data-collection declaration AMO
  // requires of new add-ons: none (nothing is sent to the developer or to
  // third parties; see PRIVACY.md). Firefox before 140 ignores the key, and
  // with "none" there is no consent to ask for there either.
  if (m.background) delete m.background.service_worker;
  m.browser_specific_settings = {
    gecko: {
      id: release.firefoxId,
      strict_min_version: '128.0',
      update_url: release.firefoxUpdatesJsonUrl,
      data_collection_permissions: { required: ['none'] }
    }
  };
  return m;
}
