// Assembles per-browser unpacked extension trees ready for packing/signing.
//
// `build.mjs` produces dist/. This script builds on top of it and writes two
// complete, loadable extension trees:
//
//   build/chrome/    — Chromium manifest (service_worker background)
//   build/firefox/   — Firefox manifest (scripts background + gecko id/update_url)
//
// The GitHub Actions release workflow runs this, then packs build/chrome into a
// signed CRX and signs build/firefox into an XPI. Locally, load build/chrome or
// build/firefox as an unpacked extension.
//
// Usage: node scripts/pack.mjs [--version X.Y.Z]

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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');

const versionArg = (() => {
  const i = process.argv.indexOf('--version');
  return i !== -1 ? process.argv[i + 1] : null;
})();

const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const release = JSON.parse(readFileSync(path.join(root, 'release.config.json'), 'utf8'));
const version = versionArg ?? manifest.version;

// 1. Build dist/.
execSync('node scripts/build.mjs', { cwd: root, stdio: 'inherit' });

// 2. Files every packaged tree needs (besides the manifest, written per-browser),
// as [source in the repo, path in the packaged tree].
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
  ['fonts', 'fonts'],
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

// 3. Chromium tree — service_worker background, no gecko settings.
{
  const dest = stage('chrome');
  const m = structuredClone(manifest);
  m.version = version;
  if (m.background) delete m.background.scripts;
  delete m.browser_specific_settings;
  writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(m, null, 2));
}

// 4. Firefox tree — scripts background, gecko id + update_url for auto-update.
{
  const dest = stage('firefox');
  const m = structuredClone(manifest);
  m.version = version;
  if (m.background) delete m.background.service_worker;
  m.browser_specific_settings = {
    gecko: {
      id: release.firefoxId,
      strict_min_version: '128.0',
      update_url: release.firefoxUpdatesJsonUrl
    }
  };
  writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(m, null, 2));
}

console.log(`extension packed (v${version}) → build/chrome, build/firefox`);
