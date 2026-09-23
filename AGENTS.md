# AGENTS.md — belz-extension

You are the Maintainer Agent for this browser extension. This file is the canonical map of the codebase and the contract for keeping it accurate.

## Purpose

A browser extension that augments Automation Designer (AD), Page Designer (PD), and the DevTools layer of Service Designer's web UI with productivity tooling for engineers.

## Tech & runtime

- TypeScript in strict mode, no framework. Bun bundles `.ts` directly; `tsc` only checks types (`noEmit`) and never produces the shipped code. Imports are extensionless (`moduleResolution: bundler`).
- Manifest V3 (`manifest.json`).
- Build: `scripts/build.mjs`, then `scripts/escape-non-ascii.mjs` over every output for extension-loader compatibility. The AD and PD content scripts are built together as **one code-split ES-module graph** into `dist/modules/`; every other entry is a standalone bundle. See "Content-script module graph" below.
- Per-browser packaging: `scripts/pack.mjs` assembles `build/chrome/` and `build/firefox/` trees, the second adding `browser_specific_settings.gecko` for AMO signing.
- Targets: **runtime-editable** — the manifest declares no static `host_permissions` at all; the user's granted hosts live in `chrome.storage.local` under `sdExtensionHostsV1` and are managed via the options page. `src/background/index.ts` reconciles `chrome.scripting.registerContentScripts` against that list.
- **No external dependencies at runtime.** The extension talks only to the site the user is inspecting, reusing that page's own session. There is no companion server, CLI, or localhost service.

## Layout: one folder per JavaScript world

Each top-level folder of `src/` runs in its own JavaScript world: its own bundle, its own memory. Code in one folder never shares state with another at runtime, even when both import the same module. `config/` is the exception: plain constants, safe for all of them.

```
src/
  config/                    constants shared by every world (no state)
    settings.ts              the settings schema: keys, defaults, valid values, modal rows
    selectors.ts             every selector read from the AD/PD pages
    timings.ts               every wait tuned against the AD/PD pages
    routes.ts                /automation-designer/, /ui-designer/, /pages/
    endpoints.ts             CHAIN_PATH_RE, chain/designer path builders
    storage-keys.ts          SETTINGS/HOSTS/FOCUS/AD_CACHE storage keys
    namespace.ts             ns() / nsAttr() + EXTENSION_OWNED_ATTR: the extension's own DOM names
  shared/                    helpers shared by every world (each world gets its own copy)
    hosts.ts                 the allowed-sites list: validation + storage
    logger.ts                createLogger(scope): the only console output
    messages.ts              runtime message shapes + type guards
    dom.ts                   required(): an element the page's own HTML must have
    focus-flag.ts            the focus-a-panel shortcut: background writes, panels watch

  designer/                  content scripts on AD and PD designer pages
    ad-content.ts            entry, /automation-designer/*
    pd-content.ts            entry, /ui-designer/*
    core/                    bootstrap, Feature contract, settings store, page observer, Rearm
    features/                one folder per feature (see below)
    ui/                      modal frame, modal lock, toast, styles, theme, hover overlay
    utils/                   dom + clipboard helpers

  pd-inspector-page/         content script on published /pages/* (built to dist/pd-inspector.js)
    index.ts                 entry: starts PdEngine
    engine.ts                PdEngine: answers the PD Inspector panel; inspect mode
    config.ts                fetches page/shell/component compiled configs
    component-tree.ts        the component-nesting tree (config only, exact)
    tree.ts                  normalised config-node tree + visibility
    resolve.ts               Resolver: DOM element -> owning config node (className anchors)
    highlight.ts             Highlighter: on-page highlight overlay (shadow DOM, ns() host id)
    types.ts                 config, tree and engine data shapes

  devtools/
    devtools.html            DevTools page shell
    devtools-page.ts         entry: starts PanelRegistrar
    panel-registrar.ts       PanelRegistrar: registers the two panels on allowed sites
    inspected.ts             evalInPage(): run an expression in the inspected page
    view.ts                  el() + FocusFlash: DOM helpers shared by both panels
    ad-network/              "AD Network" panel
      panel.html, panel.ts   entry: starts AdNetworkPanel
      network-panel.ts       AdNetworkPanel: the table, capture, row actions, wiring
      detail.ts              DetailPane: Headers / Payload / Response / Timing
      names.ts               MethodNames + ResolveQueue: names, batched lookups, retry
      origin.ts              InspectedSite: inspected origin + designer-host override
      api.ts                 MethodResolver: platform chain-API client (auth reuse, v2 -> v1)
      cache.ts               MethodCache: SWR cache of uuid -> name/category
      pending-capture.ts     PendingCapture: fetch/XHR wrapper for in-flight requests
      extract.ts             classifyChainUrl + body parser (pure)
      format.ts              HAR reading and formatting (pure)
      view.ts                icon buttons, flashes, key/value grid
      json-tree.ts           collapsible JSON view
      types.ts               HarEntry, MethodSummary, Row, …
    pd-inspector/            "PD Inspector" panel
      panel.html, panel.ts   entry: starts PdInspectorPanel
      inspector-panel.ts     PdInspectorPanel; talks to src/pd-inspector-page via background

  background/
    index.ts                 entry: wires listeners, PD relay, focus commands
    content-scripts.ts       registers content scripts per allowed host; seeding
  options/                   options page (user-editable host list)
    options.html, index.ts
```

Designer features (`src/designer/features/`): `title-updater` (tab title), `keyboard` (shortcuts), `run-test` (Run Test lookup + click), `json-editor` (JSON modal: extractor, sync engine, type adapters), `output-copy` (hover copy icon), `textarea-editor` (shared hover overlay + lazy CodeMirror modal), `curl-autofill` (autofill from the AD Network panel; started directly by `ad-content.ts`), `settings` (the always-on ⚙ button, shortcuts and settings modal).

The page-side PD Inspector folder is `pd-inspector-page/` and the DevTools panel folder is `devtools/pd-inspector/`: the first runs inside the published page, the second is the panel UI. The page-side bundle keeps its output name `dist/pd-inspector.js`, which `background/content-scripts.ts` registers.

**HTML pages live next to their script** but ship at the root of the packaged extension: `scripts/pack.mjs` copies `src/devtools/devtools.html`, `src/devtools/ad-network/panel.html`, `src/devtools/pd-inspector/panel.html` and `src/options/options.html` to `devtools.html`, `panel.html`, `panel-pd.html` and `options.html`. Keep that placement: Chromium resolves a DevTools panel page path against the extension root and Firefox against the devtools page, and they agree only when all of them sit together at the root.

`manifest.json`, the `standalone` list in `scripts/build.mjs` and `SHARED` in `scripts/pack.mjs` are the source of truth for paths — keep them in sync with this layout when adding or removing an entry point.

## Build & release

| Command | Purpose |
|---|---|
| `bun install` | install dependencies |
| `bun run build` | bundle to `dist/`, then pack `build/chrome/` + `build/firefox/` |
| `bun run build:dist` | `dist/` only (skips packing) |
| `bun run dev` | rebuild both packaged trees on every save (`scripts/dev.mjs`) |
| `bun run typecheck` | `tsc` over `src/` (`tsconfig.json`) and `tests/` (`tests/tsconfig.json`) |
| `bun test` | unit tests (happy-dom + a fake `chrome`), ~1 s |
| `bun run test:e2e` | the packaged extension in headless Chromium and Firefox |

Load the per-browser tree from `build/`, never the repo root — the root `manifest.json` is a template carrying both background styles, split per browser by `scripts/pack.mjs`.

A `v*` tag pushed to the remote triggers `.github/workflows/release.yml` — see README.md for the full flow + required secrets.

## Testing

- **Unit tests: `bun test`.** They live in `tests/`, mirroring `src/`. `tests/setup.ts` (preloaded via `bunfig.toml`) installs a happy-dom DOM and the in-memory `chrome` API from `tests/fakes/chrome.ts` before any source module loads. `tests/fixtures/ad-inputs.ts` renders a minimal Automation Designer Inputs step for the JSON editor tests. `tests/build/bundle.test.ts` runs the real build and fails if the editor becomes part of the page-load bundle, if that bundle passes 100 KB, or if the JSON editor (marker: its "Edit Input JSON" title) reaches `pd-content.js`'s static-import closure. CI (`.github/workflows/test.yml`) runs the type-check, the unit tests and the build on every push.
- **Never `expect()` a value that holds DOM nodes.** When such an assertion fails, bun's failure printer walks the whole happy-dom object graph and allocates without limit: one did reach ~10 GB and got the terminal killed by the out-of-memory killer. Compare plain fields, or identities with `expect(a === b).toBe(true)`. As a backstop, `tests/memory-guard-worker.ts` kills the test run at 1 GB (`BELZ_TEST_MEMORY_LIMIT_MB` to change it).
- **End-to-end: `bun run test:e2e`** (`tests/e2e/run.mjs`). It builds, copies both packaged trees, and changes only their manifests: a static content script on a local page, plus access to 127.0.0.1. Then it loads the shipped files in headless Chromium (DevTools protocol) and Firefox (WebDriver BiDi), on `tests/e2e/page.html`. The page drives itself: the content script runs, the editor is not loaded until clicked, the overlay appears (including on a disabled, "published" textarea), the editor opens with the text and detects SQL, and the lazily loaded editor and the eager shortcut share one modal lock. A browser that is not installed is skipped. Match patterns in the patched manifest carry no port: Firefox rejects a pattern with one.
- **Modules that act on import** (the panels, the options page, `background/index.ts`) are thin wiring. Their logic lives in importable modules (`shared/hosts.ts`, `background/content-scripts.ts`, `json-editor/values.ts`, `textarea-editor/language.ts`, …) so it can be tested.

## Feature flow (AD/PD)

1. Each entry (`ad-content.ts`, `pd-content.ts`) creates its features and passes them to `bootstrap()`, keyed by the setting that switches each on.
2. `bootstrap()` subscribes to the settings store and starts or stops each feature as its setting changes, for the life of the page. A feature that throws while starting is logged and retried on the next change.
3. Settings UI (`Ctrl + ,`) toggles features in real time and persists to `chrome.storage.local`.

### Classes and singletons

Code that holds state or has a lifecycle is a class; pure helpers stay functions.

- **`Feature`** (`core/feature.ts`): `start()` / `stop()`. Each toggleable feature is a class implementing it: `TitleUpdater`, `KeyboardShortcuts`, `JsonEditor`, `OutputCopy`, `TextareaEditor`. Both must be safe to call twice, and `stop()` must undo everything `start()` did (listeners, timers, observer subscriptions, injected DOM; a feature that owns a modal calls its `dispose()`). Event handlers are arrow-function properties so `removeEventListener` gets the same function. `SettingsLauncher` is not a Feature: it is always on, for the life of the page.
- **Dependencies are passed in**, not imported, where a feature would otherwise drag code into the wrong bundle: `KeyboardShortcuts` takes the JSON editor's `open` as a constructor argument, which only `ad-content.ts` passes, so PD pages do not bundle the JSON editor.
- **`Rearm`** (`core/rearm.ts`) re-registers page listeners a few times while the host SPA boots (listeners attached too early were observed to go dead), at `TIMINGS.rearmDelays`. `HoverOverlay` and `KeyboardShortcuts` use it. `KeyboardShortcuts` also re-attaches its keydown listener on every page change through `pageObserver.subscribe` (unsubscribed in `stop()`): without that self-healing, a listener the page dropped after boot left the shortcuts silently dead until a settings toggle.
- **Page-wide singletons**: one instance per page, exported next to the class. `settings` (`SettingsStore`, with its storage injected: `chromeSettingsStorage()` in the extension, an in-memory one in tests), `pageObserver` (`PageObserver`), `modalLock` (`ModalLock`), `toast` (`Toast`), and the three modals: `jsonEditorModal`, `settingsModal`, `textareaEditorModal`. They are shared by several features and by the lazily loaded editor chunk, which is why each must be bundled once (see "Content-script module graph").
- **`HoverOverlay`** (`ui/hover-overlay.ts`) is a class the features own an instance of: `OutputCopy` and `TextareaEditor` each create one.
- **The other worlds follow the same rule.** The PD Inspector content script is `PdEngine` with a `Resolver` and a `Highlighter`; it drops a build that a newer route change has overtaken. The AD Network panel is `AdNetworkPanel`, composed of `InspectedSite`, `MethodCache`, `MethodResolver`, `MethodNames`, `ResolveQueue`, `DetailPane` and `PendingCapture`. The PD Inspector panel is `PdInspectorPanel`; the DevTools page is a `PanelRegistrar` (`panel-registrar.ts`). Each entry file (`panel.ts`, `index.ts`, `devtools-page.ts`) only constructs and starts its class, so the class can be tested without side effects (`tests/devtools/ad-network-panel.test.ts` drives the real panel markup, and calls `stop()` in `afterAll` so no timer outlives it).
- **Same lifecycle contract everywhere.** `PdEngine`, `Highlighter`, `AdNetworkPanel`, `DetailPane`, `PendingCapture`, `ResolveQueue`, `PdInspectorPanel` and `PanelRegistrar` all have `start()` / `stop()` (ResolveQueue: `stop()` only), safe to call twice, with `stop()` removing every listener, interval and timer `start()` added. Constructors only store references: `AdNetworkPanel` reads the inspected origin, site list and cache in `start()`, `DetailPane` wires its buttons in `start()`, `Highlighter` listens to scroll/resize only between `start()` and `stop()`, and `PdEngine` starts it only after its page-context check. Watchers return their unsubscribe function (`watchFocusFlag`, `InspectedSite.watchSiteConfig`). Async work that can outlive a `stop()` carries a generation check (`PendingCapture.poll`, `ResolveQueue.flush`, the panels' loads). `PanelRegistrar.stop()` stops watching only: DevTools cannot remove a panel.

### Settings, selectors, timings: one place each

- **Settings.** `src/config/settings.ts` is the only list of settings. Each entry gives its label, description, default, allowed values and the settings-modal section (`features`, `editor`, `advanced`). The `Settings` type, `DEFAULT_SETTINGS`, validation (`sanitizeSetting`) and the modal's rows are all derived from it. To add a setting, add one entry there. `designer/core/settings.ts` only holds the page's live copy and keeps it in step with `chrome.storage`.
- **Host-page selectors.** Every selector that reads the designers' own markup is in `src/config/selectors.ts`, grouped by area (`HEADER`, `AD`, `PD`, `AD_INPUTS`, `AD_WIDGETS`). A list means "try in order, first match wins" (`firstMatch()` in `designer/utils/dom.ts`). The extension's own ids and classes are not there: they are built with `ns()` next to the code that creates them.
- **Host-page timings.** Waits tuned against the designers' rendering (widget polls, pauses after clicks, first-try delays, `rearmDelays`, `pdRoutePoll`) are in `src/config/timings.ts`. Timings of the extension's own UI (hover grace, Esc Esc window) stay next to their code, except `panelFocusFlash`, which both DevTools panels share (through `FocusFlash` in `devtools/view.ts`).

### Logging

All console output goes through `createLogger(scope)` from `src/shared/logger.ts`: `log.debug/info/warn/error`, printed as `[belz:<scope>] …`. Warnings and errors always print; debug and info print only while the **Debug Logging** setting is on (settings modal → Advanced). Each JavaScript world follows that setting through `chrome.storage`. `tests/shared/logger.test.ts` fails if any other file calls `console.*`. Code injected into the inspected page (`pending-capture.ts`) runs without extension APIs and does not log.

## Runtime host management

1. The manifest has no `host_permissions` at all, only `optional_host_permissions: ["*://*/*"]`.
2. `options.html` is the user-facing surface — add a host, we call `chrome.permissions.request({ origins: [\`https://${host}/*\`] })` from the submit gesture and, on grant, write the host into `chrome.storage.local[sdExtensionHostsV1]`.
3. `src/background/index.ts` listens for `chrome.storage.onChanged` on that key and reconciles `chrome.scripting.registerContentScripts` — three registrations per host (AD, PD, PD-Inspector) with stable IDs (`ad-<host>`, `pd-<host>`, `pdi-<host>`).
4. `chrome.runtime.onStartup` / `onInstalled` also trigger reconcile so the registrations are restored on browser start / extension update.
5. Revoke reverses everything: `chrome.scripting.unregisterContentScripts` → `chrome.permissions.remove` → storage delete.
6. **Seeding.** Uninstalling an extension clears its storage, and a Firefox temporary add-on is uninstalled on every reload — so the host list would be lost on each rebuild. If a `sites.default.json` is present in the extension root (gitignored; see `sites.default.json.example`, copied into both trees by `pack.mjs`), `chrome.runtime.onInstalled` restores the list from it when storage has no host key at all. An explicitly emptied list stores `{hosts: []}` and is therefore never re-seeded.
7. **Entries must carry a boolean `enabled`.** `readHosts()` drops any stored entry without a string `host` and a boolean `enabled` (the legacy shape without the flag is gone).
8. **Grant state is read from the browser, not storage.** Seeded entries are written `enabled:false, seeded:true` — a permission cannot be restored without a user gesture. `options.ts` calls `chrome.permissions.contains` for every host on each render and reconciles the stored `enabled` flag against it, so a host revoked outside the page (or a list carried into a different profile) shows a **Grant** button rather than a stale Revoke. It also subscribes to `chrome.permissions.onAdded` / `onRemoved` to repaint on out-of-band changes.

## JSON sync engine (the most fragile piece)

- `designer/features/json-editor/extractor.ts` walks the AD Inputs DOM via the `AD_INPUTS` selectors in `config/selectors.ts` to produce a `{ key, value, type, control }` set.
- `designer/features/json-editor/sync.ts` normalizes incoming JSON values against each input's declared type:
  - Text / Number / Integer / Boolean / Date / DateTime / Json / Array / Map / StructuredData
- Special controls handled inline:
  - boolean `exp-select`
  - date pickers (programmatic calendar navigation + model event dispatch)
  - structured-data textareas
- Sync result (`SyncResult` in `sync.ts`): `{ success, message, errors, warnings, filledCount, skippedMissingKeys, failedKeys }`.

## DevTools panel (AD chain inspector)

Two capture pipelines feed the panel:

1. **`chrome.devtools.network`** (in `network-panel.ts` — the completed-request feed).
   - `onRequestFinished` streams live completions.
   - `getHAR()` is called once on init to backfill anything captured before the user first opened our panel tab. Entries are keyed by `url + startedDateTime` for dedup.
   - `src/devtools/ad-network/extract.ts` classifies chain URLs and extracts the method name from definition-fetch bodies.
2. **`src/devtools/ad-network/pending-capture.ts`** (the in-flight feed).
   - Injects a fetch + XMLHttpRequest wrapper into the inspected page via `chrome.devtools.inspectedWindow.eval`.
   - The wrapper tracks live AD chain requests in `window.__belzADPending`; the panel polls that map ~2× per second and renders each entry as a pending row that disappears on completion.
   - Reinstalled on `chrome.devtools.network.onNavigated`; idempotent per page context.

### Name / category / designer-URL resolution

The extension is **self-contained** — it depends on no local service, CLI, or third-party API. Everything it needs about a method it reads from the inspected instance itself:

1. `InspectedSite` (`origin.ts`) resolves two origins. `apiOrigin` is the inspected window's own origin. `designerOrigin` is the same unless the user recorded a `designerHost` override for that site on the options page (split public/staff-portal deployments). No host mapping is hardcoded.
2. `MethodResolver` (`api.ts`) calls `GET /rest/api/automation/chain/v2/<uuid>?basicInfo=false` on `apiOrigin`, falling back to the V1 path on non-auth errors, and normalises both shapes to `{ name, category, state, referenceId }`. The designer URL is then `designerOrigin + /automation-designer/<category>/<draftUuid>`, where a `PUBLISHED` method routes through its `referenceId` (the linked draft).
3. Auth reuses whatever the page already has, in order: the `Authorization` / `Expertly-Auth-Token` header lifted off an observed chain request in the HAR; a JWT found by a generic scan of page `localStorage`/`sessionStorage`; cookies alone via `credentials: 'include'`. All three rely on the host grant the panel already requires.
4. `MethodCache` (`cache.ts`) memoises results in `chrome.storage.local` under `sdExtensionAdCacheV1`, keyed `<origin>|<uuid>`. Fresh for 6h, stale-but-served (with background revalidation) to 14d, capped at 800 entries with oldest-first eviction.

`ResolveQueue` (`names.ts`) batches resolves behind a 250 ms debounce with a concurrency of 4, and retries transport/auth failures every 4 s — the user may still be signing in when the panel opens.

Cross-browser caveat: Firefox can't access `chrome.tabs` from a DevTools script directly, so `background/index.ts` relays messages between the PD panel and the target tab.

Focus-hint shortcut: `Ctrl+Shift+A` / `Ctrl+Shift+P` fire background `chrome.commands` — neither Chrome nor Firefox exposes an API for extensions to open or switch DevTools panels, so the background writes a session flag (`shared/focus-flag.ts`) and each panel reacts (scroll+pulse+focus for AD, refetch+pulse for PD) when the flag targets it.

## PD Inspector

Answers one question on a published page: *which Page Designer components are on it, and which one owns this piece of the UI?* Two halves, with very different certainty.

- **Component tree — exact.** `config.ts` fetches the page's compiled config from the deployable endpoint, then every PD component it embeds, recursively. A component reference is a childless `isSymbol` node. `component-tree.ts` assembles the nesting from configs alone, never the DOM, so it is always right. A page can render inside an **app shell**: a separate PAGE, looked up by the first path segment, whose layout contains a `router-outlet` node. The shell is where navbar and sidebar come from. When one exists, the content page is spliced in at the outlet. Only the config's outlet counts: the rendered page also contains Angular's own `<router-outlet>` elements.
- **Inspect mode — anchored, not guessed.** The runtime does not mark component boundaries in the DOM, but a config node's static `props.className` survives onto its rendered element. `resolve.ts` pins elements to config nodes by className: one node and one element is exact; several of each are paired in document order only when the counts agree, and refused otherwise, because a wrong anchor shadows the right one further up. Hovering an element climbs to the nearest anchored ancestor. The panel shows how many nodes were anchored.
- **Wiring.** The panel (`PdInspectorPanel`, `devtools/pd-inspector/inspector-panel.ts`) calls the engine through the background relay, because Firefox gives DevTools panels no `chrome.tabs`. The engine pushes messages back with `chrome.runtime.sendMessage` (`PdPushMessage` in `shared/messages.ts`): inspect-mode picks, and `routeChanged`. The panel ignores pushes from other tabs. All messages carry `ns: 'pd'`. Published pages are SPAs, so the engine polls the path every `TIMINGS.pdRoutePoll`; on a change it leaves inspect mode, drops any in-flight build (the generation is bumped even when the new path is not a published page, which then reports an error state instead of the old model), and pushes `routeChanged`, on which the panel resets its Inspect button and reloads. Page Designer's config vocabulary (outlet, form-field and button node names) is in `PD_CONFIG_NODES` in `config/selectors.ts`.

## Textarea overlay (performance-critical)

`designer/features/textarea-editor/index.ts` injects **one** controls element for the whole page, positioned over whichever textarea has pointer or keyboard focus. Do not reintroduce per-textarea DOM.

- Hover/focus is handled by capture-phase delegation on `document`, using `event.composedPath()[0]` so open shadow roots resolve to the real inner target. A textarea added later therefore needs no registration and no rescan — this feature deliberately does **not** subscribe to the MutationObserver.
- Read-only and **disabled** textareas qualify, so a PUBLISHED AD method gets the overlay too — only drafts did before. The modal already refuses to write back to a read-only source (`TextareaEditorModal.showSource()` disables Save).
- A `disabled` control dispatches no pointer events: the browser retargets the hover to its nearest enabled ancestor, so delegation never sees the textarea. `resolveTarget` therefore also receives the originating **event** and hit-tests `document.elementFromPoint`, which is not suppressed the same way. `output-copy` runs the same hit test so the two overlays never both claim one pointer position.
- Repositioning is coalesced through `requestAnimationFrame` with a 32 ms `setTimeout` backstop, because rAF is suspended in backgrounded tabs and headless rendering; without the backstop the overlay can linger over the wrong element.
- The page's own markup is never restructured. The previous design wrapped every textarea in a positioned `<div>` plus a controls node (~480 elements on a 40-step method), which forced a layout pass over all of them and made the extension a major source of the mutations it was reacting to.

Measured node visits per single DOM mutation on a synthetic 40-step method (7,973 nodes, 120 textareas): **2,138,128 → 80**. Idle cost is zero. If you change this file, re-run the benchmark before and after.

## Content-script module graph (lazy editor)

The editor modal (`designer/features/textarea-editor/modal.ts`) carries CodeMirror and every language mode, ~590 KB. It used to be ~94% of each content script, parsed on every AD and PD page load. It is now reached only through `import('./modal')` in `textarea-editor/index.ts`, and fetched on the first **Open** click.

| | Before | After |
|---|---|---|
| Parsed on every AD page load | 641 KB | 53 KB |
| Parsed on every PD page load | 638 KB | 50 KB |
| Fetched on first Open click | — | 590 KB (then cached; reopen ~50 ms) |

How it fits together:

- `dist/ad-content.js` and `dist/pd-content.js` are **generated loaders**, written by `build.mjs`. Content scripts cannot be ES modules, so each loader just `import()`s the real entry from `dist/modules/`. They keep the paths `background/content-scripts.ts` registers, so registrations did not change.
- `dist/modules/` is one `bun build --splitting` over both entries (`src/designer/ad-content.ts`, `src/designer/pd-content.ts`): the entries, shared chunks, and the lazy editor chunk (`chunk-<hash>.js`). `build.mjs` wipes `dist/` first so a stale hashed chunk can never ship.
- `manifest.json` lists `dist/modules/*` in `web_accessible_resources`. **This is required**: without it both Chromium and Firefox refuse the import (verified).

**The rule that must not be broken: one `--splitting` call, never a separate build for the editor.** `modal.ts` imports `core/settings`, `ui/modal-lock`, `ui/toast` and the settings modal — module-level singletons. Built separately, the chunk gets its own copies. That was tested deliberately in both browsers: the editor still opens and looks perfect, but `Ctrl+Shift+Enter` fires Run Test *behind the open editor*, because the shortcut checks a different copy of the modal lock. One graph makes the shared modules shared chunks, loaded once per page.

**This rule is enforced.** `scripts/check-singletons.mjs` runs at the end of every build and fails it if any stateful module is bundled more than once into the designer content scripts. Each stateful module starts with a marker, `/*! belz-singleton: designer/core/settings */`. It is a "legal" comment, so the minifier keeps it and it travels with the module into whichever output file holds it. Each marker must then appear in exactly one designer output file. The check also scans `src/designer/`, `src/config/` and `src/shared/` for top-level state (`let`/`var`, or a top-level object built with `new`: a `Set`/`Map` or a class instance such as `export const settings = new SettingsStore(…)`) and fails on any such module that has no marker, so a new stateful module can't slip past unprotected. When it fails, the message names the module and files, or the exact marker line to add. It was verified against five ways of breaking the rule: the editor added as a standalone entry, a separate bundle dropped into `dist/modules`, a marker stripped from the output, a marker deleted from the source, and a new unmarked module. All five fail the build, including through `pack.mjs`. Output files that run in a different JavaScript world (background, options, DevTools pages, `pd-inspector.js` from `src/pd-inspector-page/`) are excluded by an explicit, reasoned list in the script. Do not add a file there to make the check pass.

To lazy-load something else, just use `import()` inside a module in this graph; the bundler handles the rest. Anything reached by a **static** import is eager. To check what a page load costs, walk the static-import closure of `dist/modules/ad-content.js`, not file sizes.

## Known risks

- **DOM coupling is high.** Selectors in `src/config/selectors.ts` depend on the AD/PD UI's current class names. When the UI changes upstream, these break first.
- **Inline styles in modals.** Heavy use of inline style strings — refactors here are noisy; keep them confined.
- **Date picker / select internals.** AD's custom controls dispatch synthetic events on internal state changes; sync.ts has hand-tuned event sequences.
- **`dist/modules/*` is web-accessible on every `https://` page.** That is what lets a content script import it, but it also lets any https page request those files by URL. In Chromium the extension ID is stable, so a page that knows it could detect the extension is installed. (Firefox uses a random per-install UUID, so it cannot.) The files contain no secrets. `use_dynamic_url` would close this in Chromium but has not been tested.

## Safe-change checklist

1. After selector edits, smoke test on a real AD page and a real PD page.
2. After `sync.ts` changes, exercise boolean / date / structured-data paths manually.
3. After manifest changes, validate both Chromium (`build/chrome/manifest.json`) and Firefox (`build/firefox/manifest.json`) outputs from `scripts/pack.mjs`.
4. After adding a new entry point, update `manifest.json`, `scripts/build.mjs`, `scripts/pack.mjs` SHARED list (if you're adding an HTML surface), and the table at the top of this file. A new **content script** that shares code with AD/PD belongs in the split graph (`splitEntries` in `build.mjs`), not as a standalone bundle.
5. Rebuild `dist/` before shipping any change that touches `src/`.
6. When adding a hardcoded string that looks like a URL, path, storage key, or DOM identifier — put it in `src/config/` instead of inlining. Grep for existing entries there before adding a new file.

## Maintainer Agent contract

When you make a meaningful change — new feature, changed selectors, sync behavior, manifest scope, file layout — update this `AGENTS.md` in the same commit. The README.md is the public-facing version; mention user-facing changes there too.
