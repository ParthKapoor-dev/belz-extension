# `tests/build/`

Tests of what the build produces: the bundle in `dist/modules/`, and the per-browser manifests. They guard properties that unit tests of the source cannot see.

## Contents

| File | What it does |
|---|---|
| [`bundle.test.ts`](bundle.test.ts) | Runs `node scripts/build.mjs` once in `beforeAll`, then checks the designer content-script bundles. |
| [`manifest.test.ts`](manifest.test.ts) | Calls `browserManifest()` from [`scripts/manifests.mjs`](../../scripts/manifests.mjs) (what `pack.mjs` writes) for Chromium and Firefox. No build, so it is fast. |

## What is covered: manifests

For both browsers:

- `permissions` is exactly `scripting` and `storage` (no `activeTab`), and there are no static `host_permissions`.
- `optional_host_permissions` is `https://*/*` only.
- `web_accessible_resources` exposes only `dist/modules/*`, to `https://*/*` pages.
- The version passed in is the manifest's version.

Per browser: Chromium has a `service_worker` background and no `browser_specific_settings`; Firefox has a `scripts` background, the gecko id from `release.config.json` and `strict_min_version` `128.0`.

`manifests.mjs` is a plain `.mjs` module without types, so the test imports it by path at run time.

## What is covered: bundle

1. **The singleton check passed.** The build log contains `singleton check: N stateful modules, each bundled once` (printed by [`scripts/check-singletons.mjs`](../../scripts/check-singletons.mjs)).
2. **The editor is not loaded with the page.** For `ad-content.js` and `pd-content.js`, no file in the static-import closure contains `.cm-scroller` (a string only the CodeMirror editor carries), and the closure is under 100 KB (`EAGER_BUDGET`).
3. **The editor exists as exactly one lazy chunk**, and `ad-content.js`'s closure reaches it through `import("./chunk-...")`.
4. **The JSON editor is AD-only.** Its modal title, `Edit Input JSON`, is in `ad-content.js`'s closure and not in `pd-content.js`'s.
5. **The `#{variable}` scanner is AD-only.** Its logger scope, `"ad-scope"`, is likewise only in `ad-content.js`'s closure.

Checks 4 and 5 also assert the marker *is* in the AD bundle, so a renamed title or scope fails the test instead of passing silently.

## How it works

`staticClosure(entry)` starts at an entry file in `dist/modules/` and follows only static imports (`import ... from "./x.js"` and bare `import "./x.js"`), never `import("./x.js")`. That set is what the browser parses on every page load.

## Conventions

- `bundle.test.ts` rebuilds `dist/` (the build deletes it first). Run it knowing any existing `dist/` is replaced.
- The markers are plain strings from the source. If you rename the JSON editor's title, the `ad-scope` logger scope, or the editor's `.cm-scroller` styling, update the constants at the top of the file.
- Why the editor must be lazy and why stateful modules must be bundled once is explained in [AGENTS.md](../../AGENTS.md) ("Content-script module graph") and [`scripts/README.md`](../../scripts/README.md).
