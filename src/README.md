# `src/`

All the extension's TypeScript and HTML source. Bun bundles it into `dist/`, and `scripts/pack.mjs` then assembles the per-browser trees under `build/`. Each top-level folder runs in its own JavaScript world, except `config/` and `shared/`, which every world imports.

## Contents

| File / directory | What it does |
|---|---|
| [`designer/`](designer/) | Content scripts on Automation Designer (`/automation-designer/*`) and Page Designer (`/ui-designer/*`) pages: the editor overlay, JSON input editor, shortcuts, settings modal |
| [`pd-inspector-page/`](pd-inspector-page/) | Content script on published pages (`/pages/*`): the engine that answers the PD Inspector panel |
| [`devtools/`](devtools/) | The DevTools page and its two panels, **AD Network** and **PD Inspector** |
| [`background/`](background/) | Background service worker: registers content scripts per allowed site, relays PD Inspector messages, handles browser-level shortcuts |
| [`options/`](options/) | The options page, where the user manages the allowed sites |
| [`config/`](config/) | Constants only: settings schema, host-page selectors and timings, routes, endpoints, storage keys, DOM name prefix |
| [`shared/`](shared/) | Small helpers used by several worlds: logger, allowed-sites list, message shapes, focus flag |

There are no loose files in `src/` itself.

## JavaScript worlds

A browser extension is not one program. Each part runs in a separate JavaScript context with its own globals, its own copy of every imported module, and its own set of extension APIs. Two worlds never share a variable at runtime, even when they import the same file.

| World | Where it runs | Source | Bundle |
|---|---|---|---|
| Designer content scripts | Inside AD and PD tabs, in the isolated content-script world: sees the page DOM, not the page's own JS variables | [`designer/`](designer/) | `dist/ad-content.js`, `dist/pd-content.js` (loaders) + `dist/modules/` |
| PD Inspector content script | Inside published `/pages/*` tabs, same kind of world | [`pd-inspector-page/`](pd-inspector-page/) | `dist/pd-inspector.js` |
| Background | The extension's service worker (Chromium) or background script (Firefox). No DOM | [`background/`](background/) | `dist/background.js` |
| DevTools page and panels | Extension pages inside the DevTools window. They reach the inspected tab only through `chrome.devtools.*` and the background relay | [`devtools/`](devtools/) | `dist/devtools-page.js`, `dist/panel.js`, `dist/panel-pd.js` |
| Options page | An ordinary extension page in its own tab | [`options/`](options/) | `dist/options.js` |

`config/` holds plain constants, so it is safe in every world. `shared/` modules are bundled into each world that imports them; each world gets its own copy.

Content scripts are not in the manifest. The background registers them at runtime for each site the user allows, with `chrome.scripting.registerContentScripts` (see [`background/`](background/)).

## How it connects

- **Worlds talk only through extension channels:** `chrome.runtime` messages (shapes in `shared/messages.ts`) and `chrome.storage` (keys in `config/storage-keys.ts`). For example, the settings modal in `designer/` writes settings to `chrome.storage.local`, and every world's logger follows the **Debug Logging** setting through storage.
- **Entry points** are listed in `scripts/build.mjs` (`splitEntries` for the two designer scripts, `standalone` for the rest) and in `manifest.json`. HTML pages live next to their script and are copied to the extension root by `scripts/pack.mjs`.

## Conventions

- One folder per world. Code that would run in two worlds goes in `shared/` (helpers) or `config/` (constants).
- A new content script that shares code with the designer scripts joins the split build (`splitEntries`), not a standalone bundle, so page-wide singletons stay single.
- Selectors, timings, routes, storage keys and URL paths belong in `config/`, not inline.
- All console output goes through `createLogger()` from `shared/logger.ts`.

See [AGENTS.md](../AGENTS.md) for the full rules, the module-graph rule and the safe-change checklist.

## Testing

Unit tests live in [`tests/`](../tests/), in folders that mirror `src/`. How to run them is in the Development section of the [root README](../README.md).

## Adding or changing things

Adding a new entry point (a new world or a new page): update `manifest.json`, the entry lists in `scripts/build.mjs`, the `SHARED` list in `scripts/pack.mjs` if it has an HTML page, and the layout in [AGENTS.md](../AGENTS.md).
