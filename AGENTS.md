# AGENTS.md — belz-extension

You are the Maintainer Agent for this browser extension. This file is the canonical map of the codebase and the contract for keeping it accurate.

## Purpose

A browser extension that augments Automation Designer (AD), Page Designer (PD), and the DevTools layer of Service Designer's web UI with productivity tooling for engineers.

## Tech & runtime

- Plain JavaScript (ES modules) — no TypeScript, no React.
- Manifest V3 (`manifest.json`).
- Build: `scripts/build.mjs`, then `scripts/escape-non-ascii.mjs` over every output for extension-loader compatibility. The AD and PD content scripts are built together as **one code-split ES-module graph** into `dist/modules/`; every other entry is a standalone bundle. See "Content-script module graph" below.
- Per-browser packaging: `scripts/pack.mjs` assembles `build/chrome/` and `build/firefox/` trees, the second adding `browser_specific_settings.gecko` for AMO signing.
- Targets: **runtime-editable** — the manifest declares no static `host_permissions` at all; the user's granted hosts live in `chrome.storage.local` under `sdExtensionHostsV1` and are managed via the options page. `src/background/index.js` reconciles `chrome.scripting.registerContentScripts` against that list.
- **No external dependencies at runtime.** The extension talks only to the site the user is inspecting, reusing that page's own session. There is no companion server, CLI, or localhost service.

## Layout: one folder per JavaScript world

Each top-level folder of `src/` runs in its own JavaScript world: its own bundle, its own memory. Code in one folder never shares state with another at runtime, even when both import the same module. `config/` is the exception: plain constants, safe for all of them.

```
src/
  config/                    constants shared by every world (no state)
    constants.js             DOM selectors, observer config, feature flags
    routes.js                /automation-designer/, /ui-designer/, /pages/
    endpoints.js             CHAIN_PATH_RE, chain/designer path builders
    storage-keys.js          SETTINGS/HOSTS/FOCUS/AD_CACHE storage keys
    namespace.js             EXT_PREFIX + ns() helper for DOM identifiers

  designer/                  content scripts on AD and PD designer pages
    ad-content.js            entry, /automation-designer/*
    pd-content.js            entry, /ui-designer/*
    core/                    bootstrap, settings, state, logger, observer
    features/                one folder per feature (see below)
    ui/                      modal frame, modal lock, toast, styles, theme, hover overlay
    utils/                   dom + clipboard helpers

  pd-inspector/              content script on published /pages/*
    index.js                 entry
    engine.js                answers the PD Inspector panel; inspect mode
    config.js                fetches page/shell/component compiled configs
    component-tree.js        the component-nesting tree (config only, exact)
    tree.js                  normalised config-node tree + visibility
    resolve.js               DOM element -> owning config node (className anchors)
    highlight.js             on-page highlight overlay (shadow DOM)

  devtools/
    devtools.html            DevTools page shell
    devtools-page.js         entry: registers the two panels on allowed sites
    ad-network/              "AD Network" panel
      panel.html, panel.js   entry + UI
      extract.js             classifyChainUrl + body parser (pure)
      origin.js              inspected origin + designer-host override
      api.js                 platform chain-API client (auth reuse, v2 -> v1)
      cache.js               SWR cache of uuid -> name/category
      pending-capture.js     fetch/XHR wrapper for in-flight requests
      json-tree.js           collapsible JSON view
    pd-inspector/            "PD Inspector" panel
      panel.html, panel.js   entry + UI; talks to src/pd-inspector via background

  background/index.js        script registrar, focus-command listener, PD relay
  options/                   options page (user-editable host list)
    options.html, index.js
```

Designer features (`src/designer/features/`): `title-updater` (tab title), `keyboard` (shortcuts), `run-test` (Run Test lookup + click), `json-editor` (JSON modal: extractor, sync engine, type adapters), `output-copy` (hover copy icon), `textarea-editor` (shared hover overlay + lazy CodeMirror modal), `curl-autofill` (autofill from the AD Network panel), `settings` (settings modal).

**HTML pages live next to their script** but ship at the root of the packaged extension: `scripts/pack.mjs` copies `src/devtools/devtools.html`, `src/devtools/ad-network/panel.html`, `src/devtools/pd-inspector/panel.html` and `src/options/options.html` to `devtools.html`, `panel.html`, `panel-pd.html` and `options.html`. Keep that placement: Chromium resolves a DevTools panel page path against the extension root and Firefox against the devtools page, and they agree only when all of them sit together at the root.

`manifest.json`, the `standalone` list in `scripts/build.mjs` and `SHARED` in `scripts/pack.mjs` are the source of truth for paths — keep them in sync with this layout when adding or removing an entry point.

## Build & release

| Command | Purpose |
|---|---|
| `bun install` | install dependencies |
| `bun run build` | bundle to `dist/`, then pack `build/chrome/` + `build/firefox/` |
| `bun run build:dist` | `dist/` only (skips packing) |
| `bun run dev` | rebuild both packaged trees on every save (`scripts/dev.mjs`) |

Load the per-browser tree from `build/`, never the repo root — the root `manifest.json` is a template carrying both background styles, split per browser by `scripts/pack.mjs`.

A `v*` tag pushed to the remote triggers `.github/workflows/release.yml` — see README.md for the full flow + required secrets.

## Feature flow (AD/PD)

1. On load, the content script reads persisted settings and starts only the features marked enabled.
2. Each feature module exports `start()` / `stop()` and registers a MutationObserver if it needs to react to DOM changes.
3. Settings UI (`Ctrl + ,`) toggles features in real time and persists to `chrome.storage.local`.

## Runtime host management

1. The manifest has no `host_permissions` at all, only `optional_host_permissions: ["*://*/*"]`.
2. `options.html` is the user-facing surface — add a host, we call `chrome.permissions.request({ origins: [\`https://${host}/*\`] })` from the submit gesture and, on grant, write the host into `chrome.storage.local[sdExtensionHostsV1]`.
3. `src/background/index.js` listens for `chrome.storage.onChanged` on that key and reconciles `chrome.scripting.registerContentScripts` — three registrations per host (AD, PD, PD-Inspector) with stable IDs (`ad-<host>`, `pd-<host>`, `pdi-<host>`).
4. `chrome.runtime.onStartup` / `onInstalled` also trigger reconcile so the registrations are restored on browser start / extension update.
5. Revoke reverses everything: `chrome.scripting.unregisterContentScripts` → `chrome.permissions.remove` → storage delete.
6. **Seeding.** Uninstalling an extension clears its storage, and a Firefox temporary add-on is uninstalled on every reload — so the host list would be lost on each rebuild. If a `sites.default.json` is present in the extension root (gitignored; see `sites.default.json.example`, copied into both trees by `pack.mjs`), `chrome.runtime.onInstalled` restores the list from it when storage has no host key at all. An explicitly emptied list stores `{hosts: []}` and is therefore never re-seeded.
7. **Grant state is read from the browser, not storage.** Seeded entries are written `enabled:false, seeded:true` — a permission cannot be restored without a user gesture. `options.js` calls `chrome.permissions.contains` for every host on each render and reconciles the stored `enabled` flag against it, so a host revoked outside the page (or a list carried into a different profile) shows a **Grant** button rather than a stale Revoke. It also subscribes to `chrome.permissions.onAdded` / `onRemoved` to repaint on out-of-band changes.

## JSON sync engine (the most fragile piece)

- `designer/features/json-editor/extractor.js` walks the AD Inputs DOM via `config/constants.js` selectors to produce a `{ key, value, type, control }` set.
- `designer/features/json-editor/sync.js` normalizes incoming JSON values against each input's declared type:
  - Text / Number / Integer / Boolean / Date / DateTime / Json / Array / Map / StructuredData
- Special controls handled inline:
  - boolean `exp-select`
  - date pickers (programmatic calendar navigation + model event dispatch)
  - structured-data textareas
- Sync result: `{ success, warnings, errors, counts, failed, missing }`.

## DevTools panel (AD chain inspector)

Two capture pipelines feed the panel:

1. **`chrome.devtools.network`** (in `panel.js` — the completed-request feed).
   - `onRequestFinished` streams live completions.
   - `getHAR()` is called once on init to backfill anything captured before the user first opened our panel tab. Entries are keyed by `url + startedDateTime` for dedup.
   - `src/devtools/ad-network/extract.js` classifies chain URLs and extracts the method name from definition-fetch bodies.
2. **`src/devtools/ad-network/pending-capture.js`** (the in-flight feed).
   - Injects a fetch + XMLHttpRequest wrapper into the inspected page via `chrome.devtools.inspectedWindow.eval`.
   - The wrapper tracks live AD chain requests in `window.__belzADPending`; the panel polls that map ~2× per second and renders each entry as a pending row that disappears on completion.
   - Reinstalled on `chrome.devtools.network.onNavigated`; idempotent per page context.

### Name / category / designer-URL resolution

The extension is **self-contained** — it depends on no local service, CLI, or third-party API. Everything it needs about a method it reads from the inspected instance itself:

1. `src/devtools/ad-network/origin.js` resolves two origins. `apiOrigin` is the inspected window's own origin. `designerOrigin` is the same unless the user recorded a `designerHost` override for that site on the options page (split public/staff-portal deployments). No host mapping is hardcoded.
2. `src/devtools/ad-network/api.js` calls `GET /rest/api/automation/chain/v2/<uuid>?basicInfo=false` on `apiOrigin`, falling back to the V1 path on non-auth errors, and normalises both shapes to `{ name, category, state, referenceId }`. The designer URL is then `designerOrigin + /automation-designer/<category>/<draftUuid>`, where a `PUBLISHED` method routes through its `referenceId` (the linked draft).
3. Auth reuses whatever the page already has, in order: the `Authorization` / `Expertly-Auth-Token` header lifted off an observed chain request in the HAR; a JWT found by a generic scan of page `localStorage`/`sessionStorage`; cookies alone via `credentials: 'include'`. All three rely on the host grant the panel already requires.
4. `src/devtools/ad-network/cache.js` memoises results in `chrome.storage.local` under `sdExtensionAdCacheV1`, keyed `<origin>|<uuid>`. Fresh for 6h, stale-but-served (with background revalidation) to 14d, capped at 800 entries with oldest-first eviction.

`panel.js` batches resolves behind a 250 ms debounce with a concurrency of 4, and retries transport/auth failures every 4 s — the user may still be signing in when the panel opens.

Cross-browser caveat: Firefox can't access `chrome.tabs` from a DevTools script directly, so `background.js` relays messages between the PD panel and the target tab.

Focus-hint shortcut: `Ctrl+Shift+A` / `Ctrl+Shift+P` fire background `chrome.commands` — neither Chrome nor Firefox exposes an API for extensions to open or switch DevTools panels, so the background writes a session flag and each panel reacts (scroll+pulse+focus for AD, refetch+pulse for PD) when the flag targets it.

## PD Inspector

Answers one question on a published page: *which Page Designer components are on it, and which one owns this piece of the UI?* Two halves, with very different certainty.

- **Component tree — exact.** `config.js` fetches the page's compiled config from the deployable endpoint, then every PD component it embeds, recursively. A component reference is a childless `isSymbol` node. `component-tree.js` assembles the nesting from configs alone, never the DOM, so it is always right. A page can render inside an **app shell**: a separate PAGE, looked up by the first path segment, whose layout contains a `router-outlet` node. The shell is where navbar and sidebar come from. When one exists, the content page is spliced in at the outlet. Only the config's outlet counts: the rendered page also contains Angular's own `<router-outlet>` elements.
- **Inspect mode — anchored, not guessed.** The runtime does not mark component boundaries in the DOM, but a config node's static `props.className` survives onto its rendered element. `resolve.js` pins elements to config nodes by className: one node and one element is exact; several of each are paired in document order only when the counts agree, and refused otherwise, because a wrong anchor shadows the right one further up. Hovering an element climbs to the nearest anchored ancestor. The panel shows how many nodes were anchored.
- **Wiring.** The panel (`devtools/pd-inspector/panel.js`) calls the engine through the background relay, because Firefox gives DevTools panels no `chrome.tabs`. The engine pushes inspect-mode picks back with `chrome.runtime.sendMessage`. All messages carry `ns: 'pd'`. Published pages are SPAs, so the engine rebuilds when the path changes.

## Textarea overlay (performance-critical)

`designer/features/textarea-editor/index.js` injects **one** controls element for the whole page, positioned over whichever textarea has pointer or keyboard focus. Do not reintroduce per-textarea DOM.

- Hover/focus is handled by capture-phase delegation on `document`, using `event.composedPath()[0]` so open shadow roots resolve to the real inner target. A textarea added later therefore needs no registration and no rescan — this feature deliberately does **not** subscribe to the MutationObserver.
- Read-only and **disabled** textareas qualify, so a PUBLISHED AD method gets the overlay too — only drafts did before. The modal already refuses to write back to a read-only source (`updateModalForSource` disables Save).
- A `disabled` control dispatches no pointer events: the browser retargets the hover to its nearest enabled ancestor, so delegation never sees the textarea. `resolveTarget` therefore also receives the originating **event** and hit-tests `document.elementFromPoint`, which is not suppressed the same way. `output-copy` runs the same hit test so the two overlays never both claim one pointer position.
- Repositioning is coalesced through `requestAnimationFrame` with a 32 ms `setTimeout` backstop, because rAF is suspended in backgrounded tabs and headless rendering; without the backstop the overlay can linger over the wrong element.
- The page's own markup is never restructured. The previous design wrapped every textarea in a positioned `<div>` plus a controls node (~480 elements on a 40-step method), which forced a layout pass over all of them and made the extension a major source of the mutations it was reacting to.

Measured node visits per single DOM mutation on a synthetic 40-step method (7,973 nodes, 120 textareas): **2,138,128 → 80**. Idle cost is zero. If you change this file, re-run the benchmark before and after.

## Content-script module graph (lazy editor)

The editor modal (`designer/features/textarea-editor/modal.js`) carries CodeMirror and every language mode, ~590 KB. It used to be ~94% of each content script, parsed on every AD and PD page load. It is now reached only through `import('./modal.js')` in `textarea-editor/index.js`, and fetched on the first **Open** click.

| | Before | After |
|---|---|---|
| Parsed on every AD page load | 641 KB | 53 KB |
| Parsed on every PD page load | 638 KB | 50 KB |
| Fetched on first Open click | — | 590 KB (then cached; reopen ~50 ms) |

How it fits together:

- `dist/ad-content.js` and `dist/pd-content.js` are **generated loaders**, written by `build.mjs`. Content scripts cannot be ES modules, so each loader just `import()`s the real entry from `dist/modules/`. They keep the paths `background.js` registers, so registrations did not change.
- `dist/modules/` is one `bun build --splitting` over both entries (`src/designer/ad-content.js`, `src/designer/pd-content.js`): the entries, shared chunks, and the lazy editor chunk (`chunk-<hash>.js`). `build.mjs` wipes `dist/` first so a stale hashed chunk can never ship.
- `manifest.json` lists `dist/modules/*` in `web_accessible_resources`. **This is required**: without it both Chromium and Firefox refuse the import (verified).

**The rule that must not be broken: one `--splitting` call, never a separate build for the editor.** `modal.js` imports `core/state`, `core/settings` and `ui/modal-lock` — module-level singletons. Built separately, the chunk gets its own copies. That was tested deliberately in both browsers: the editor still opens and looks perfect, but `Ctrl+Shift+Enter` fires Run Test *behind the open editor*, because the shortcut checks a different copy of the modal lock. One graph makes the shared modules shared chunks, loaded once per page.

**This rule is enforced.** `scripts/check-singletons.mjs` runs at the end of every build and fails it if any stateful module is bundled more than once into the designer content scripts. Each stateful module starts with a marker, `/*! belz-singleton: designer/core/state */`. It is a "legal" comment, so the minifier keeps it and it travels with the module into whichever output file holds it. Each marker must then appear in exactly one designer output file. The check also scans `src/designer/` and `src/config/` for top-level state (`let`/`var`, a module-level `Set`/`Map`, the `state` object) and fails on any such module that has no marker, so a new stateful module can't slip past unprotected. When it fails, the message names the module and files, or the exact marker line to add. It was verified against five ways of breaking the rule: the editor added as a standalone entry, a separate bundle dropped into `dist/modules`, a marker stripped from the output, a marker deleted from the source, and a new unmarked module. All five fail the build, including through `pack.mjs`. Output files that run in a different JavaScript world (background, options, DevTools pages, `pd-inspector.js`) are excluded by an explicit, reasoned list in the script. Do not add a file there to make the check pass.

To lazy-load something else, just use `import()` inside a module in this graph; the bundler handles the rest. Anything reached by a **static** import is eager. To check what a page load costs, walk the static-import closure of `dist/modules/ad-content.js`, not file sizes.

## Known risks

- **DOM coupling is high.** Selectors in `src/config/constants.js` depend on the AD/PD UI's current class names. When the UI changes upstream, these break first.
- **Inline styles in modals.** Heavy use of inline style strings — refactors here are noisy; keep them confined.
- **Date picker / select internals.** AD's custom controls dispatch synthetic events on internal state changes; sync.js has hand-tuned event sequences.
- **Console noise.** Bootstrap and JSON flows still log via `core/logger.js`. Levels gate output but the calls remain — review before shipping anything verbose.
- **`dist/modules/*` is web-accessible on every `https://` page.** That is what lets a content script import it, but it also lets any https page request those files by URL. In Chromium the extension ID is stable, so a page that knows it could detect the extension is installed. (Firefox uses a random per-install UUID, so it cannot.) The files contain no secrets. `use_dynamic_url` would close this in Chromium but has not been tested.

## Safe-change checklist

1. After selector edits, smoke test on a real AD page and a real PD page.
2. After `sync.js` changes, exercise boolean / date / structured-data paths manually.
3. After manifest changes, validate both Chromium (`build/chrome/manifest.json`) and Firefox (`build/firefox/manifest.json`) outputs from `scripts/pack.mjs`.
4. After adding a new entry point, update `manifest.json`, `scripts/build.mjs`, `scripts/pack.mjs` SHARED list (if you're adding an HTML surface), and the table at the top of this file. A new **content script** that shares code with AD/PD belongs in the split graph (`splitEntries` in `build.mjs`), not as a standalone bundle.
5. Rebuild `dist/` before shipping any change that touches `src/`.
6. When adding a hardcoded string that looks like a URL, path, storage key, or DOM identifier — put it in `src/config/` instead of inlining. Grep for existing entries there before adding a new file.

## Maintainer Agent contract

When you make a meaningful change — new feature, changed selectors, sync behavior, manifest scope, file layout — update this `AGENTS.md` in the same commit. The README.md is the public-facing version; mention user-facing changes there too.
