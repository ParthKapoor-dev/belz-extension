# `src/designer/`

The content scripts that run inside Automation Designer (`/automation-designer/*`) and Page Designer (`/ui-designer/*`) tabs. They add the extension's tools to those pages: the large text editor, the JSON input editor, copy buttons, keyboard shortcuts, tab titles and the settings modal.

## Contents

| File / directory | What it does |
|---|---|
| [`ad-content.ts`](ad-content.ts) | Entry for AD pages: builds every AD feature, passes them to `bootstrap()`, and starts curl autofill |
| [`pd-content.ts`](pd-content.ts) | Entry for PD pages: only the features that work on any designer page |
| [`core/`](core/) | `bootstrap()`, the `Feature` contract, the settings store, the shared page observer, `Rearm` |
| [`features/`](features/) | One folder per feature |
| [`ui/`](ui/) | Shared UI pieces: hover overlay, modal lock, toast, modal chrome, button styles, theme tokens |
| [`utils/`](utils/) | DOM lookups and clipboard copy |

## How it works

1. The background registers `dist/ad-content.js` and `dist/pd-content.js` on each allowed site (see [`../background/`](../background/)). Both are small generated loaders that `import()` the real entry from `dist/modules/`.
2. The entry creates its feature objects and calls `bootstrap()` from [`core/bootstrap.ts`](core/bootstrap.ts), keyed by the setting that switches each one on.
3. `bootstrap()` waits for `DOMContentLoaded` if needed, then subscribes to the settings store and starts or stops each feature as its setting changes. It also starts `SettingsLauncher`, which is always on.

What each entry passes in:

| Setting key | AD | PD |
|---|---|---|
| `titleUpdater` | `TitleUpdater` | `TitleUpdater` |
| `runTestShortcut` | `KeyboardShortcuts` with the JSON editor's `open` | `KeyboardShortcuts` without it |
| `jsonEditor` | `JsonEditor` | not bundled |
| `outputCopy` | `OutputCopy` | `OutputCopy` |
| `textareaEditor` | `TextareaEditor` with `scanScope` as its scope provider | `TextareaEditor` without one |

`ad-content.ts` also calls `startCurlAutofillFeature()` directly. It is not a toggleable feature.

## How it connects

- **Used by:** the background registers the loaders per allowed host. `scripts/build.mjs` builds both entries in one code-split build (`splitEntries`).
- **Depends on:** [`../config/`](../config/) (settings schema, selectors, timings, routes, `ns()`), [`../shared/`](../shared/) (logger, message guards), `chrome.storage.local` for settings, `chrome.runtime.onMessage` for the open-settings command, and the AD/PD page markup.

## Conventions

- **Pass dependencies in to keep PD small.** AD-only code (the JSON editor, the `#{variable}` scanner) is reached only from `ad-content.ts`, as constructor arguments. `pd-content.ts` must not import it. `tests/build/bundle.test.ts` checks this.
- **The editor is lazy.** `features/textarea-editor/modal.ts` (CodeMirror) is reached only through `import('./modal')`. Anything reached by a static import loads on every page.
- **Singletons are bundled once.** Modules with page-wide state (`settings`, `pageObserver`, `modalLock`, `toast`, the three modals) start with a `/*! belz-singleton: ... */` marker, and `scripts/check-singletons.mjs` fails the build if one is bundled twice. A new stateful module here needs the marker.
- The extension's own DOM ids and classes use `ns()`, and injected nodes carry `EXTENSION_OWNED_ATTR` (both from `config/namespace.ts`), so the overlays skip them.

See the "Content-script module graph" and "Feature flow" sections of [AGENTS.md](../../AGENTS.md).

## Testing

Unit tests are in [`tests/designer/`](../../tests/designer/). [`tests/build/bundle.test.ts`](../../tests/build/bundle.test.ts) checks the bundle split, and [`tests/e2e/`](../../tests/e2e/) runs the built content script in real browsers. How to run them is in the Development section of the [root README](../../README.md).

## Adding or changing things

Adding a feature: see [`features/`](features/). A feature that also runs on PD goes into both entries; an AD-only one goes into `ad-content.ts` only.
