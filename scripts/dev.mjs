// Rebuilds build/chrome and build/firefox whenever a source file changes.
//
// `bun build --watch` cannot be used here: a build is several bundler runs
// (one split graph plus a standalone bundle per entry), a post-processing pass
// and the packing step, so a watch on any single run would leave the packaged
// trees stale. This watches the inputs and re-runs the whole pipeline instead.
//
// The browser does not pick up a rebuilt extension on its own: reload it from
// chrome://extensions (or about:debugging in Firefox), then reload the page.
//
// usage: bun run dev
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Directories watched recursively. */
const WATCHED_DIRS = ['src', 'fonts'];
/**
 * Files at the repo root that the build reads: pack.mjs reads the manifest,
 * release.config.json and the optional (gitignored) sites.default.json. The
 * root is watched non-recursively and filtered to these names, so a
 * sites.default.json created after `bun run dev` started is picked up too.
 */
const WATCHED_ROOT_FILES = new Set(['manifest.json', 'release.config.json', 'sites.default.json']);
/** Editors write a file in several steps; wait for them to settle. */
const DEBOUNCE_MS = 150;

let running = false;
let queued = false;
let timer = null;

function build() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  const started = Date.now();
  const child = spawn('node', ['scripts/pack.mjs'], { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => {
    running = false;
    const took = ((Date.now() - started) / 1000).toFixed(1);
    console.log(code === 0
      ? `\n[dev] rebuilt in ${took}s — reload the extension, then the page`
      : '\n[dev] build FAILED — fix the error above, the watcher keeps running');
    if (queued) {
      queued = false;
      build();
    }
  });
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(build, DEBOUNCE_MS);
}

for (const dir of WATCHED_DIRS) {
  if (existsSync(path.join(root, dir))) watch(path.join(root, dir), { recursive: true }, schedule);
}
watch(root, (_event, filename) => {
  if (filename && WATCHED_ROOT_FILES.has(String(filename))) schedule();
});
console.log(`[dev] watching ${[...WATCHED_DIRS, ...WATCHED_ROOT_FILES].join(', ')}`);
build();
