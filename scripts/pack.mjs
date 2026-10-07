// Assembles per-browser unpacked extension trees ready for packing/signing.
//
// `build.mjs` produces dist/. This script builds on top of it and writes two
// complete, loadable extension trees:
//
//   build/chrome/    — Chromium manifest (service_worker background, plus the
//                      `key` from scripts/release.config.json's chromePublicKey if set)
//   build/firefox/   — Firefox manifest (scripts background + gecko settings)
//
// The GitHub Actions release workflow runs this with --store, zips build/chrome
// for the Chrome Web Store and signs build/firefox into an XPI. Locally, load
// build/chrome or build/firefox as an unpacked extension.
//
// Usage: node scripts/pack.mjs [--version X.Y.Z] [--store]
//   --store  build/chrome is the Web Store package: no `key` in its manifest.

import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserManifest } from './manifests.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');

const versionArg = (() => {
  const i = process.argv.indexOf('--version');
  return i !== -1 ? process.argv[i + 1] : null;
})();

const store = process.argv.includes('--store');

const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const release = JSON.parse(readFileSync(path.join(root, 'scripts/release.config.json'), 'utf8'));
const version = versionArg ?? manifest.version;

// 1. Build dist/.
execSync('node scripts/build.mjs', { cwd: root, stdio: 'inherit' });

// 2. Files every packaged tree needs (besides the manifest, written per-browser),
// as [source in the repo, path in the packaged tree].
//
// The icons and fonts live under assets/ in the repo but keep their packaged
// paths (icons/…, fonts/…), which manifest.json and the pages' @font-face
// rules name. assets/screenshots/ is for the docs and never ships.
//
// The HTML pages live next to their scripts in src/ but are placed at the ROOT
// of the packaged tree. That location is load-bearing: Chromium resolves a
// DevTools panel's page path against the extension root, Firefox against the
// devtools page, and both agree only when the devtools page and the panels
// sit together at the root. See src/devtools/panel-registrar.ts.
//
// `sites.default.json` is optional and gitignored — when the user keeps one it
// ships in the tree so a fresh install can restore their site list. stage()
// skips any entry that does not exist.
const SHARED = [
  ['dist', 'dist'],
  ['assets/fonts', 'fonts'],
  ...[16, 32, 48, 128].map((s) => [`assets/icons/icon-${s}.png`, `icons/icon-${s}.png`]),
  ['src/devtools/devtools.html', 'devtools.html'],
  ['src/devtools/ad-network/panel.html', 'panel.html'],
  ['src/devtools/pd-inspector/panel.html', 'panel-pd.html'],
  ['src/options/options.html', 'options.html'],
  ['sites.default.json', 'sites.default.json']
];

/** Copy the shared payload into build/<target>/. */
function stage(target) {
  const dest = path.join(buildDir, target);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const [from, to] of SHARED) {
    const source = path.join(root, from);
    if (existsSync(source)) cpSync(source, path.join(dest, to), { recursive: true });
  }
  return dest;
}

// 3. One tree per browser family, each with its own manifest (manifests.mjs):
// Chromium gets a service_worker background and no gecko settings; Firefox a
// scripts background plus the gecko settings for signing and auto-update.
for (const target of ['chrome', 'firefox']) {
  const dest = stage(target);
  const m = browserManifest(manifest, target, { version, release, store });
  writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(m, null, 2));
}

console.log(`extension packed (v${version}${store ? ', Chrome Web Store package' : ''}) → build/chrome, build/firefox`);
