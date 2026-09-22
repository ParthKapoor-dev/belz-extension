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
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCHED = ['src', 'fonts', 'manifest.json'];
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

for (const entry of WATCHED) {
  watch(path.join(root, entry), { recursive: true }, schedule);
}
console.log(`[dev] watching ${WATCHED.join(', ')}`);
build();
