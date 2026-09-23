// Guards the build's two load-bearing properties, on the real build output:
//
//  1. The ~600 KB editor (CodeMirror) is NOT parsed on page load. It must be
//     reachable from the content-script entries only through a dynamic
//     import(), never a static one.
//  2. The build still passes its own singleton check (it fails otherwise).
//  3. The JSON editor (AD only) is not in the PD content script at all: only
//     ad-content.ts passes it to KeyboardShortcuts.
//  4. Nor is the AD `#{variable}` scanner: only ad-content.ts passes it to
//     TextareaEditor.
//
// Runs scripts/build.mjs, so it takes about a second.
import { beforeAll, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');
const modules = path.join(root, 'dist/modules');
/** Page-load budget per designer page, in bytes. It was 656 KB before the lazy editor. */
const EAGER_BUDGET = 100 * 1024;
/** A string only the editor module carries (its CodeMirror theme). */
const EDITOR_MARKER = '.cm-scroller';
/** A string only the JSON editor carries (its modal title). */
const JSON_EDITOR_MARKER = 'Edit Input JSON';
/** A string only the AD variable scanner carries (its logger scope). */
const SCOPE_SCANNER_MARKER = '"ad-scope"';

let buildLog = '';

/** Every file loaded eagerly from an entry: its static-import closure. */
function staticClosure(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(path.join(modules, file), 'utf8');
    // Static forms only: `import … from"./x.js"` and bare `import"./x.js"`.
    // A dynamic `import("./x.js")` is deliberately not followed.
    for (const m of code.matchAll(/(?:from|import)\s*["']\.\/([^"']+)["']/g)) visit(m[1]);
  };
  visit(entry);
  return [...seen];
}
/** The concatenated code of an entry's static-import closure. */
const closureCode = (entry: string) =>
  staticClosure(entry)
    .map((f) => readFileSync(path.join(modules, f), 'utf8'))
    .join('\n');
const sizeOf = (files: string[]) =>
  files.reduce((sum, f) => sum + readFileSync(path.join(modules, f)).length, 0);

beforeAll(() => {
  buildLog = execSync('node scripts/build.mjs', { cwd: root, encoding: 'utf8', stdio: 'pipe' });
});

describe('build output', () => {
  test('the singleton check ran and passed', () => {
    expect(buildLog).toMatch(/singleton check: \d+ stateful modules, each bundled once/);
  });

  for (const entry of ['ad-content.js', 'pd-content.js']) {
    test(`${entry}: the editor is not loaded with the page`, () => {
      const eager = staticClosure(entry);
      const withEditor = eager.filter((f) =>
        readFileSync(path.join(modules, f), 'utf8').includes(EDITOR_MARKER));
      expect(withEditor).toEqual([]);
      expect(sizeOf(eager)).toBeLessThan(EAGER_BUDGET);
    });
  }

  test('pd-content.js does not bundle the JSON editor; ad-content.js does', () => {
    expect(closureCode('pd-content.js').includes(JSON_EDITOR_MARKER)).toBe(false);
    // The marker is live: without this, a renamed title would pass silently.
    expect(closureCode('ad-content.js').includes(JSON_EDITOR_MARKER)).toBe(true);
  });

  test('pd-content.js does not bundle the AD variable scanner; ad-content.js does', () => {
    expect(closureCode('pd-content.js').includes(SCOPE_SCANNER_MARKER)).toBe(false);
    expect(closureCode('ad-content.js').includes(SCOPE_SCANNER_MARKER)).toBe(true);
  });

  test('the editor exists as a lazily loaded chunk', () => {
    const chunks = readdirSync(modules).filter((f) =>
      readFileSync(path.join(modules, f), 'utf8').includes(EDITOR_MARKER));
    expect(chunks).toHaveLength(1);
    expect(closureCode('ad-content.js')).toContain(`import("./${chunks[0]}")`);
  });
});
