// Every directory in the repository explains itself in a README.md, and every
// relative link in a README (or AGENTS.md) points at something that exists.
// A new folder without a README, or a README left pointing at a renamed file,
// fails here instead of going stale quietly.
import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');

/**
 * `.github/README.md` would replace the root README on the repository's GitHub
 * page, so `.github/` itself is exempt; `.github/workflows/` is not.
 */
const EXEMPT = new Set(['.github']);

function trackedFiles(): string[] {
  return execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** Every directory holding a tracked file, plus all of its ancestors. */
function directories(files: string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    for (let dir = path.dirname(file); dir !== '.'; dir = path.dirname(dir)) dirs.add(dir);
  }
  return [...dirs].filter((dir) => !EXEMPT.has(dir)).sort();
}

/** Relative link targets in a Markdown file: `[text](target)`, minus URLs and anchors. */
function relativeLinks(markdown: string): string[] {
  const links: string[] = [];
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]!.split('#')[0]!;
    if (!target || /^[a-z]+:/i.test(target)) continue;
    links.push(decodeURIComponent(target));
  }
  return links;
}

const files = trackedFiles();

describe('documentation', () => {
  test('every directory has a README.md', () => {
    const missing = directories(files).filter((dir) => !existsSync(path.join(root, dir, 'README.md')));
    expect(missing).toEqual([]);
  });

  test('relative links in READMEs and AGENTS.md resolve', () => {
    const docs = files.filter((file) => /(^|\/)(README|AGENTS)\.md$/.test(file));
    const broken: string[] = [];
    for (const doc of docs) {
      const dir = path.dirname(path.join(root, doc));
      for (const link of relativeLinks(readFileSync(path.join(root, doc), 'utf8'))) {
        if (!existsSync(path.resolve(dir, link))) broken.push(`${doc} -> ${link}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
