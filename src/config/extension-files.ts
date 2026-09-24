// Paths of the extension's own files, relative to the root of the packaged
// extension (build/chrome, build/firefox). scripts/build.mjs and
// scripts/pack.mjs put them there; manifest.json names the rest.

/** The content scripts the background registers per allowed site. */
export const CONTENT_SCRIPT_FILES = {
  /** Automation Designer pages (a loader for dist/modules/ad-content.js). */
  ad: 'dist/ad-content.js',
  /** Page Designer pages (a loader for dist/modules/pd-content.js). */
  pd: 'dist/pd-content.js',
  /** Published pages: the PD Inspector engine. */
  pdInspector: 'dist/pd-inspector.js'
} as const;

/**
 * The DevTools panel pages. They sit at the extension root, next to
 * devtools.html: see src/devtools/panel-registrar.ts for why.
 */
export const PANEL_PAGES = {
  adNetwork: 'panel.html',
  pdInspector: 'panel-pd.html'
} as const;

/** The options page, which edits the allowed-sites list. */
export const OPTIONS_PAGE = 'options.html';

/** The optional, gitignored list of sites restored on a fresh install. */
export const SITES_SEED_FILE = 'sites.default.json';
