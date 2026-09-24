// Guards four load-bearing properties of the build, on the real build output:
//
//  1. The ~600 KB editor (CodeMirror) is NOT parsed on page load. It must be
//     reachable from the content-script entries only through a dynamic
//     import(), never a static one.
//  2. The build still passes its own singleton check (it fails otherwise).
//  3. The JSON editor (AD only) is not in the PD content script at all: only
//     ad-content.ts passes it to KeyboardShortcuts.
//  4. Nor is the AD `#{variable}` scanner: only ad-content.ts passes it to
//     Ide.
//  5. The IDE's formatter (sql-formatter) is its own lazily loaded chunk:
//     not parsed on page load, nor when the IDE opens, only on the first
//     Format.
//
// Runs scripts/build.mjs, so it rewrites dist/ and takes a few seconds.
import { beforeAll, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');
const modules = path.join(root, 'dist/modules');
/** Page-load budget per designer page, in bytes. It was 656 KB before the lazy IDE. */
const EAGER_BUDGET = 100 * 1024;
/** A string only the IDE module carries (its CodeMirror theme). */
const EDITOR_MARKER = '.cm-scroller';
/** A string only the JSON editor carries (its modal title). */
const JSON_EDITOR_MARKER = 'Edit Input JSON';
/** A string only the AD variable scanner carries (its logger scope). */
const SCOPE_SCANNER_MARKER = '"ad-scope"';
/** A string only sql-formatter carries (one of its option names). */
const SQL_FORMATTER_MARKER = 'expressionWidth';

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
    test(`${entry}: the IDE is not loaded with the page`, () => {
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

  test('the IDE exists as a lazily loaded chunk', () => {
    const chunks = readdirSync(modules).filter((f) =>
      readFileSync(path.join(modules, f), 'utf8').includes(EDITOR_MARKER));
    expect(chunks).toHaveLength(1);
    expect(closureCode('ad-content.js')).toContain(`import("./${chunks[0]}")`);
  });

  test('the formatter is a chunk of its own, loaded by the IDE on the first Format', () => {
    const chunkWith = (marker: string) => readdirSync(modules).filter((f) =>
      readFileSync(path.join(modules, f), 'utf8').includes(marker));
    const formatter = chunkWith(SQL_FORMATTER_MARKER);
    expect(formatter).toHaveLength(1);
    const [ide] = chunkWith(EDITOR_MARKER);
    for (const entry of ['ad-content.js', 'pd-content.js', ide!]) {
      expect(closureCode(entry).includes(SQL_FORMATTER_MARKER)).toBe(false);
    }
    expect(closureCode(ide!)).toContain(`import("./${formatter[0]}")`);
    // Only the PostgreSQL dialect: another dialect's keyword would mean all of them.
    expect(readFileSync(path.join(modules, formatter[0]!), 'utf8').includes('QUALIFY')).toBe(false);
  });
});
