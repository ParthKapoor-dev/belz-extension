# `scripts/`

Build tooling. These Node scripts turn `src/` into loadable extensions: bundle to `dist/`, post-process, verify the bundle, and assemble one tree per browser under `build/`. None of this code ships in the extension.

## Contents

| File | What it does | Run by |
|---|---|---|
| [`build.mjs`](build.mjs) | Bundles every entry point into `dist/` with `bun build`, escapes non-ASCII, writes the content-script loaders, then runs the singleton check. | `bun run build:dist`; also called by `pack.mjs` and `tests/build/bundle.test.ts` |
| [`pack.mjs`](pack.mjs) | Runs `build.mjs`, then writes `build/chrome/` and `build/firefox/`, each with its own manifest. | `bun run build`; also called by `dev.mjs`, `tests/e2e/run.mjs` and the release workflow |
| [`dev.mjs`](dev.mjs) | Watches `src/`, `fonts/`, `manifest.json`, `release.config.json` and `sites.default.json`, and re-runs `pack.mjs` on every change. | `bun run dev` |
| [`escape-non-ascii.mjs`](escape-non-ascii.mjs) | Rewrites one file in place, replacing every non-ASCII character with a `\uXXXX` escape (surrogate pairs above U+FFFF). | `build.mjs`, once per output file |
| [`check-singletons.mjs`](check-singletons.mjs) | Fails the build if a stateful module is bundled more than once into the designer content scripts. | `build.mjs`, as its last step |

## How it works

`bun run build` runs this chain:

1. **`pack.mjs`** reads `manifest.json` and [`release.config.json`](../release.config.json), then runs `build.mjs`.
2. **`build.mjs`** deletes `dist/` (chunk names carry a hash, so a stale chunk could otherwise ship), then:
   - builds `src/designer/ad-content.ts` and `src/designer/pd-content.ts` in **one** `bun build --splitting` call into `dist/modules/` (entries, shared chunks, and the lazily loaded editor chunk);
   - writes `dist/ad-content.js` and `dist/pd-content.js`, small loaders that `import()` the real entry from `dist/modules/` (content scripts cannot be ES modules);
   - builds each entry in its `standalone` list as its own minified bundle (`pd-inspector.js`, `background.js`, `options.js`, `devtools-page.js`, `panel.js`, `panel-pd.js`);
   - runs `escape-non-ascii.mjs` over every output file;
   - runs `check-singletons.mjs`.
3. **`check-singletons.mjs`** collects every `/*! belz-singleton: <name> */` marker in `src/`, and checks each appears in exactly one `dist/` file of the designer world. Files in its `OTHER_WORLDS` list (background, options, DevTools pages, `pd-inspector.js`) are skipped because they run with their own memory. It also fails on any module under `src/designer/`, `src/config/` or `src/shared/` that has top-level state (`let`/`var`, or a non-SCREAMING_CASE `const` built with `new`) but no marker, and prints the marker line to add.
4. **`pack.mjs`** copies the `SHARED` list (`dist/`, `fonts/`, the four HTML pages, and `sites.default.json` if present) into each tree. The HTML pages move from `src/` to the tree root. It then writes a per-browser manifest:
   - `build/chrome/`: `background.scripts` and `browser_specific_settings` removed.
   - `build/firefox/`: `background.service_worker` removed; `browser_specific_settings.gecko` added with `id` and `update_url` from `release.config.json` and `strict_min_version: '128.0'`.
   - `--version X.Y.Z` overrides the manifest version in both (the release workflow passes the tag).

**`dev.mjs`** does not use `bun build --watch`: one build is several bundler runs plus post-processing and packing. It debounces file events by 150 ms, never runs two builds at once (a change during a build queues one more), and keeps watching after a failed build. It does not reload the browser.

The reasons behind the split graph and the singleton rule are in [AGENTS.md](../AGENTS.md) ("Content-script module graph").

## Conventions

- Every script resolves the repo root from its own path, so it can run from any working directory. `escape-non-ascii.mjs` is the exception: it resolves its argument against the current directory (`build.mjs` runs it from the root).
- Scripts run under `node`, not `bun`, but call `bun build` for bundling. Both must be installed.
- Never add a file to `OTHER_WORLDS` in `check-singletons.mjs` just to make the check pass. Each entry must run in a separate JavaScript world.

## Testing

[`tests/build/bundle.test.ts`](../tests/build/bundle.test.ts) runs `build.mjs` and checks its output. CI runs the full build in [`.github/workflows/test.yml`](../.github/workflows/test.yml). For commands, see the root [README.md](../README.md) Development section.

## Adding or changing things

**A new entry point:**

1. Add it to `standalone` in `build.mjs`. A content script that shares code with the AD/PD content scripts goes in `splitEntries` instead.
2. If it has an HTML page, add the page to `SHARED` in `pack.mjs`.
3. Add it to `manifest.json`.
4. If it runs in its own JavaScript world, add its output to `OTHER_WORLDS` in `check-singletons.mjs` with the reason.
5. Update the layout in [AGENTS.md](../AGENTS.md).
