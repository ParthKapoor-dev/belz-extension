// Fails the build if a stateful module is bundled more than once into the
// designer content scripts.
//
// Why this exists. A module with module-level state — the settings store,
// the modal lock, the modals — only works if there is ONE copy of it per
// page. If a second bundle carries its own copy, both copies run and neither
// knows about the other. Nothing errors. The concrete case that was measured:
// build the lazy editor as a separate bundle, and it opens and looks perfect,
// but Ctrl+Shift+Enter fires Run Test behind the open editor, because the
// shortcut and the editor check different copies of ui/modal-lock.ts.
//
// How it works. Each stateful module starts with a marker:
//
//     /*! belz-singleton: designer/core/settings */
//
// A `/*!` comment is a "legal" comment, which the minifier keeps, and it
// travels with the module into whichever output file contains it. So the
// rule is simple: across every file that runs in the designer content-script
// world, each marker found in src/ must appear in EXACTLY ONE output file.
//
//   - twice or more: the module was bundled more than once -> fail
//   - zero times:    the marker was lost (stripped, or the module dropped out
//                    of the build), so this check can no longer vouch for it
//                    -> fail, rather than silently passing forever
//
// Adding a module with module-level state that the content script shares?
// Give it a marker. You do not have to remember to: the check also scans the
// designer source for top-level state (`let`, `var`, or a top-level object
// built with `new`, such as `export const settings = new SettingsStore(...)`)
// and fails on any such module without one.
//
// usage: node scripts/check-singletons.mjs    (run by build.mjs automatically)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER_RE = /\/\*!\s*belz-singleton:\s*([\w/.-]+)\s*\*\//g;

// Output files that run in a DIFFERENT JavaScript world from the designer
// content scripts. A module appearing in one of these as well is not a
// duplicate — it is a separate page with its own memory. Each entry needs a
// reason; do NOT add a file here just to make this check pass.
const OTHER_WORLDS = {
  'dist/background.js': 'extension service worker',
  'dist/options.js': 'the options page',
  'dist/devtools-page.js': 'the DevTools page',
  'dist/panel.js': 'the AD Network DevTools panel',
  'dist/panel-pd.js': 'the PD Inspector DevTools panel',
  'dist/pd-inspector.js': 'content script on /pages/*, never on a designer page'
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(root, p).split(path.sep).join('/');

// What SHOULD be protected: every marker declared in the source.
const expected = new Map(); // name -> source file
for (const file of walk(path.join(root, 'src')).filter((f) => f.endsWith('.ts'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(MARKER_RE)) {
    expected.set(m[1], rel(file));
  }
}

// Where each marker actually landed in the built designer world.
const found = new Map(); // name -> [output files]
const inScope = walk(path.join(root, 'dist'))
  .filter((f) => f.endsWith('.js'))
  .filter((f) => !(rel(f) in OTHER_WORLDS));

for (const file of inScope) {
  const names = new Set(
    [...readFileSync(file, 'utf8').matchAll(MARKER_RE)].map((m) => m[1]));
  for (const name of names) {
    if (!found.has(name)) found.set(name, []);
    found.get(name).push(rel(file));
  }
}

const problems = [];

// Stateful modules that nobody marked. Only source the designer content
// scripts can reach is scanned: designer/, plus config/ and shared/ which every
// world imports. The other top-level directories of src/ are separate worlds
// (background, options, DevTools, the PD inspector), where a module holding
// its own copy of state is correct.
const DESIGNER_SRC = ['src/designer/', 'src/config/', 'src/shared/'];
// State is a top-level `let`/`var`, or a top-level object built with `new`:
// a Set or Map, or a class instance such as `export const settings = new
// SettingsStore(...)`. A SCREAMING_CASE `new Set(...)` is a constant lookup
// table by convention (DATE_TYPES, say), not state, so it does not count.
const STATEFUL_RE = /^(?:export\s+)?(?:let|var)\s|^(?:export\s+)?const\s+(?![A-Z0-9_]+\b)\w+\s*(?::[^=]+)?=\s*new\s+[A-Z]\w*|^export\s+const\s+state\s*=/m;

for (const file of walk(path.join(root, 'src')).filter((f) => f.endsWith('.ts'))) {
  const r = rel(file);
  if (!DESIGNER_SRC.some((p) => r.startsWith(p))) continue;
  const src = readFileSync(file, 'utf8');
  MARKER_RE.lastIndex = 0;
  if (STATEFUL_RE.test(src) && !MARKER_RE.test(src)) {
    const name = r.replace(/^src\//, '').replace(/\.ts$/, '');
    problems.push(
      `${r} holds module-level state but has no singleton marker.\n` +
      `    Add this as its first line:  /*! belz-singleton: ${name} */`);
  }
}
MARKER_RE.lastIndex = 0;

for (const [name, source] of expected) {
  const files = found.get(name) || [];
  if (files.length > 1) {
    problems.push(
      `${name} is bundled ${files.length} times:\n` +
      files.map((f) => `      ${f}`).join('\n') + '\n' +
      `    Each copy has its own state and they will not see each other.\n` +
      `    Build these together in ONE \`bun build --splitting\` call (see build.mjs).`);
  } else if (files.length === 0) {
    problems.push(
      `${name} (${source}) appears in no designer output file.\n` +
      `    Either its marker was stripped or it left the build; this check can\n` +
      `    no longer confirm it is bundled once.`);
  }
}

if (problems.length) {
  console.error(`\nsingleton check FAILED (${problems.length}):\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}
console.log(`singleton check: ${expected.size} stateful modules, each bundled once`);
