# AGENTS.md — belz-extension

You are the Maintainer Agent for this browser extension. This file is the canonical map of the codebase and the contract for keeping it accurate.

## Purpose

A browser extension that augments Automation Designer (AD), Page Designer (PD), and the DevTools layer of Service Designer's web UI with productivity tooling for engineers.

## Tech & runtime

- TypeScript in strict mode, no framework. Bun bundles `.ts` directly; `tsc` only checks types (`noEmit`) and never produces the shipped code. Imports are extensionless (`moduleResolution: bundler`).
- Manifest V3 (`manifest.json`).
- Build: `scripts/build.mjs`, then `scripts/escape-non-ascii.mjs` over every output for extension-loader compatibility. The AD and PD content scripts are built together as **one code-split ES-module graph** into `dist/modules/`; every other entry is a standalone bundle. See "Content-script module graph" below.
- Per-browser packaging: `scripts/pack.mjs` assembles `build/chrome/` and `build/firefox/` trees with the manifests `scripts/manifests.mjs` derives (`browserManifest()`); the Firefox one adds `browser_specific_settings.gecko` for AMO signing.
- Targets: **runtime-editable** — the manifest declares no static `host_permissions` at all; the user's granted hosts live in `chrome.storage.local` under `sdExtensionHostsV1` and are managed via the options page. `ContentScriptSync` (`src/background/content-scripts.ts`) reconciles `chrome.scripting.registerContentScripts` against that list.
- **No external dependencies at runtime.** The extension talks only to the site the user is inspecting, reusing that page's own session. There is no companion server, CLI, or localhost service.

## Layout: one folder per JavaScript world

Each top-level folder of `src/` runs in its own JavaScript world: its own bundle, its own memory. Code in one folder never shares state with another at runtime, even when both import the same module. `config/` is the exception: plain constants, safe for all of them.

```
src/
  config/                    constants shared by every world (no state)
    settings.ts              the settings schema: keys, defaults, valid values, modal rows
    selectors.ts             every selector read from the AD/PD pages
    timings.ts               every wait tuned against the AD/PD pages, plus cross-world timings
    routes.ts                /automation-designer/, /ui-designer/, /pages/
    endpoints.ts             CHAIN_PATH_RE, chain/designer path builders
    storage-keys.ts          SETTINGS/HOSTS/FOCUS/AD_CACHE keys, AUTOFILL_HANDOFF_KEY_PREFIX
    namespace.ts             the `belz` prefix: ns() / nsAttr() / nsGlobal(), EXTENSION_OWNED_ATTR,
                             PAGE_GLOBALS, message keys, AUTOFILL_FRAGMENT_PARAM
    extension-files.ts       the extension's own file paths: content scripts, panel pages, seed file
  shared/                    helpers shared by every world (each world gets its own copy)
    hosts.ts                 the allowed-sites list: validation, hostPattern(), isAllowedUrl(),
                             storage, readGrants()
    logger.ts                createLogger(scope): the only console output
    messages.ts              runtime message shapes, strict type guards, sender checks
    errors.ts                errorText(): an error's message for people
    retry.ts                 isTransientStatus(): the HTTP statuses worth retrying
    rich-link.ts             copyRichLink(): the escaped HTML + Markdown link (Shift+L, Slack link)
    autofill-handoff.ts      the "Open in draft" body handoff: storeHandoff() / takeHandoff()
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
    engine.ts                PdEngine: answers the PD Inspector panel; inspect mode + watchdog
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
      network-panel.ts       AdNetworkPanel: the table, capture, row actions, allowed-site gating
      open-draft.ts          OpenQueue, withAutofill(), openInBackgroundTab(): "Open in draft"
      status.ts              PanelStatus: the toast and the offline pill
      detail.ts              DetailPane: Headers / Payload / Response / Timing
      names.ts               MethodNames + ResolveQueue: names, batched lookups, capped retries
      origin.ts              InspectedSite: inspected origin, allowed-site check, designer-host override
      api.ts                 MethodResolver: platform chain-API client (per-origin auth, v2 -> v1)
      cache.ts               MethodCache: SWR cache of uuid -> name/category
      pending-capture.ts     PendingCapture: fetch/XHR wrapper for in-flight requests
      extract.ts             classifyChainUrl, definition + method-name parsing (pure)
      format.ts              HAR reading and formatting (pure)
      view.ts                icon buttons, flashes, key/value grid
      json-tree.ts           collapsible JSON view
      types.ts               HarEntry, MethodSummary, Row, …
    pd-inspector/            "PD Inspector" panel
      panel.html, panel.ts   entry: starts PdInspectorPanel
      inspector-panel.ts     PdInspectorPanel; talks to src/pd-inspector-page via background

  background/
    index.ts                 entry: starts ContentScriptSync, MessageRelay, CommandHandler
    content-scripts.ts       ContentScriptSync: the site list's only writer (options-page edits, grant
                             sync, seeding) and the reconcile per allowed host, in one queue
    relay.ts                 MessageRelay: PD relay + autofill handoff, validated senders only
    commands.ts              CommandHandler: open-settings and the focus shortcuts
  options/                   options page (user-editable host list)
    options.html, index.ts   entry: starts OptionsPage
    options-page.ts          OptionsPage: permission requests/removals; asks the background for each change
```

Designer features (`src/designer/features/`): `title-updater` (tab title), `keyboard` (shortcuts; `ad-link.ts` is Shift+L's link), `run-test` (Run Test lookup + click, `runTestAction`), `json-editor` (JSON modal: extractor, sync engine, type adapters), `output-copy` (hover copy icon on AD's outputs; AD only), `ide` (shared hover overlay + lazy CodeMirror modal, with `#{variable}` completion/hover/lint and a lazily loaded SQL/JSON formatter), `ad-scope` (AD-only scanner of the `#{variables}` in scope, injected into `ide`), `curl-autofill` (autofill from the AD Network panel's handoff; started directly by `ad-content.ts`), `settings` (the always-on ⚙ button, shortcuts and Settings modal).

The page-side PD Inspector folder is `pd-inspector-page/` and the DevTools panel folder is `devtools/pd-inspector/`: the first runs inside the published page, the second is the panel UI. The page-side bundle keeps its output name `dist/pd-inspector.js`, which `background/content-scripts.ts` registers (through `CONTENT_SCRIPT_FILES` in `config/extension-files.ts`).

**HTML pages live next to their script** but ship at the root of the packaged extension: `scripts/pack.mjs` copies `src/devtools/devtools.html`, `src/devtools/ad-network/panel.html`, `src/devtools/pd-inspector/panel.html` and `src/options/options.html` to `devtools.html`, `panel.html`, `panel-pd.html` and `options.html`. Keep that placement: Chromium resolves a DevTools panel page path against the extension root and Firefox against the devtools page, and they agree only when all of them sit together at the root.

`manifest.json`, the `standalone` list in `scripts/build.mjs`, `SHARED` in `scripts/pack.mjs` and `config/extension-files.ts` are the source of truth for paths — keep them in sync with this layout when adding or removing an entry point.

## Build & release

| Command | Purpose |
|---|---|
| `bun install` | install dependencies |
| `bun run build` | bundle to `dist/`, then pack `build/chrome/` + `build/firefox/` |
| `bun run build:dist` | `dist/` only (skips packing) |
| `bun run dev` | rebuild both packaged trees on every save (`scripts/dev.mjs`) |
| `bun run typecheck` | `tsc` over `src/` (`tsconfig.json`) and `tests/` (`tests/tsconfig.json`) |
| `bun test` | unit tests (happy-dom + a fake `chrome`), a few seconds; `tests/build/bundle.test.ts` runs the real build, so it rewrites `dist/` |
| `bun run test:e2e` | the packaged extension in headless Chromium and Firefox (Node.js 22 or newer: it uses the global `WebSocket`) |

Load the per-browser tree from `build/`, never the repo root — the root `manifest.json` is a template carrying both background styles, split per browser by `browserManifest()` in `scripts/manifests.mjs` (which `scripts/pack.mjs` writes out).

A `v*` tag pushed to the remote triggers `.github/workflows/release.yml`: type-check and unit tests, then build, sign and publish. The tag sets the shipped version (`pack.mjs --version`); the `version` in `manifest.json` and `package.json` is only what a local build carries. Its actions are pinned to commit SHAs, Bun to an exact version, and the signing tools (`crx3`, `web-ext`) are exact devDependencies; the CRX key exists on disk only in the signing step. Both workflows give the token read-only access by default, and grant more per job (`release`: `contents: write`; `deploy-pages`: `pages: write`, `id-token: write`); checkouts keep no credentials, and workflow expressions reach `run:` scripts only through `env:`. See [`.github/workflows/README.md`](.github/workflows/README.md) and the root README's Releasing section.

## Testing

- **Unit tests: `bun test`.** They live in `tests/`, mirroring `src/`. `tests/setup.ts` (preloaded via `bunfig.toml`) installs a happy-dom DOM and the in-memory `chrome` API from `tests/fakes/chrome.ts` before any source module loads. The fake behaves like the browser where the code depends on it: `storage.onChanged` fires a task after the write and only for values that changed, and `registerContentScripts` is all-or-nothing and rejects a duplicate id. `tests/fixtures/ad-inputs.ts` renders a minimal Automation Designer Inputs step for the JSON editor tests. `tests/build/bundle.test.ts` runs the real build and fails if the editor becomes part of the page-load bundle, if that bundle passes 100 KB, or if the JSON editor (marker: its "Edit Input JSON" title) or the AD variable scanner (marker: its `"ad-scope"` logger scope) reaches `pd-content.js`'s static-import closure, or if sql-formatter (marker: its `expressionWidth` option) reaches the page's or the IDE chunk's static closure or brings a dialect other than PostgreSQL. `tests/build/manifest.test.ts` checks the per-browser manifests' permissions without building. CI (`.github/workflows/test.yml`) runs the type-check, the unit tests and the build on every push and every pull request.
- **Wait on conditions, not on the clock.** `tests/wait.ts` has `waitFor(condition)` (generous timeout, returns as soon as the condition holds) and `nextTask()`. A fixed `sleep()` is only for proving that something does NOT happen, with a wide margin. Code whose timing a test must shorten takes it as a constructor argument that defaults to `TIMINGS` (`ResolveQueue`'s retry policy, `PdEngine`'s inspect timeout, `PdInspectorPanel`'s heartbeat).
- **Never `expect()` a value that holds DOM nodes.** When such an assertion fails, bun's failure printer walks the whole happy-dom object graph and allocates without limit: one did reach ~10 GB and got the terminal killed by the out-of-memory killer. Compare plain fields, or identities with `expect(a === b).toBe(true)`. As a backstop, `tests/memory-guard-worker.ts` kills the test run at 1 GB (`BELZ_TEST_MEMORY_LIMIT_MB` to change it).
- **Test isolation.** Every test undoes what it started: `bootstrap()` returns a teardown the lifecycle tests call, panels and features are `stop()`ped in `afterEach`/`afterAll`, and resolvers and caches are made per test.
- **End-to-end: `bun run test:e2e`** (`tests/e2e/run.mjs`). It builds, copies both packaged trees, and changes only their manifests: a static content script on a local page, plus access to 127.0.0.1. Then it loads the shipped files in headless Chromium (DevTools protocol) and Firefox (WebDriver BiDi), on `tests/e2e/page.html`. The page drives itself: the content script runs, the IDE is not loaded until clicked, the overlay appears (including on a disabled, "published" textarea), the IDE opens with the text and detects SQL, the AD variable scanner ran (footer status), `Shift+Alt+F` loads the formatter chunk and formats the SQL without the key reaching the page, and the lazily loaded IDE and the eager shortcut share one modal lock. A browser that is not installed is skipped. Match patterns in the patched manifest carry no port: Firefox rejects a pattern with one.
- **Documentation: `tests/docs/readmes.test.ts`** fails if a directory has no `README.md`, or if a relative link in any README or this file points at something that does not exist.
- **Modules that act on import** (the panels, the options page, `background/index.ts`) are thin wiring. Their logic lives in importable modules (`shared/hosts.ts`, `background/content-scripts.ts`, `background/relay.ts`, `options/options-page.ts`, `json-editor/values.ts`, `ide/language.ts`, …) so it can be tested. `PanelRegistrar` gates panels on `location.origin` through `isAllowedUrl()`, the same check as everywhere (https, and the host normalised like the stored ones), so a page on a non-default port still matches.

## Feature flow (AD/PD)

1. Each entry (`ad-content.ts`, `pd-content.ts`) creates its features and passes them to `bootstrap()`, keyed by the setting that switches each on.
2. `bootstrap()` subscribes to the settings store and starts or stops each feature as its setting changes, for the life of the page. A feature that throws while starting is logged and retried on the next change. It returns a teardown (stop every feature and the settings launcher) that only tests call.
3. The Settings modal (the ⚙ button next to the page title, `Alt+,` or `Ctrl+,` in the page, or the `Alt+Shift+S` browser command) toggles features in real time and persists to `chrome.storage.local`.

### Classes and singletons

Code that holds state or has a lifecycle is a class; pure helpers stay functions.

- **`Feature`** (`core/feature.ts`): `start()` / `stop()`. Each toggleable feature is a class implementing it: `TitleUpdater`, `KeyboardShortcuts`, `JsonEditor`, `OutputCopy`, `Ide`. Both must be safe to call twice, and `stop()` must undo everything `start()` did (listeners, timers, observer subscriptions, injected DOM, changed page state such as the tab title; a feature that owns a modal calls its `dispose()`). Event handlers are arrow-function properties so `removeEventListener` gets the same function. `SettingsLauncher` is not a Feature: it is always on for the life of the page; its `stop()` exists for the bootstrap teardown.
- **Dependencies are passed in**, not imported, where a feature would otherwise drag code into the wrong bundle or act on a page that lacks the thing. `KeyboardShortcuts` takes `ShortcutActions`: only `ad-content.ts` passes Run Test (`runTestAction`), the method link (`keyboard/ad-link.ts`) and the JSON editor (which follows the **JSON Editor** setting), so PD pages neither bundle them nor swallow their keys. Likewise `Ide` takes an optional `ScopeProvider` (`ide/scope.ts`), which only `ad-content.ts` passes (`ad-scope/scan.ts`), so PD pages do not bundle the variable scanner.
- **`Rearm`** (`core/rearm.ts`) re-registers page listeners a few times while the host SPA boots (listeners attached too early can go dead), at `TIMINGS.rearmDelays`. `HoverOverlay` and `KeyboardShortcuts` use it. `KeyboardShortcuts` also re-attaches its keydown listener on every page change through `pageObserver.subscribe` (unsubscribed in `stop()`), so a listener the page dropped after boot does not leave the shortcuts dead until a settings toggle.
- **Page-wide singletons**: one instance per page, exported next to the class. `settings` (`SettingsStore`, with its storage injected: `chromeSettingsStorage()` in the extension, an in-memory one in tests), `pageObserver` (`PageObserver`), `modalLock` (`ModalLock`), `toast` (`Toast`), the three modals (`jsonEditorModal`, `settingsModal`, `ideModal`), and the logger's debug switch in `shared/logger.ts`. They are shared by several features and by the lazily loaded IDE chunk, which is why each must be bundled once (see "Content-script module graph").
- **`ModalLock`** counts holds (nested modals work) and keeps the open modals in order: each modal locks with itself as owner, and its key handler acts only while `modalLock.isTopmost(this)` and the event is not already handled. One `Esc` therefore closes only the topmost modal (the Settings modal over the IDE or the JSON editor), and the IDE's `Ctrl+S` does nothing under the Settings modal.
- **`HoverOverlay`** (`ui/hover-overlay.ts`) is a class the features own an instance of: `OutputCopy` and `Ide` each create one.
- **The host app can wipe `<body>`.** Anything that caches an element it put on the page checks `isConnected` before reusing it and rebuilds otherwise: `HoverOverlay`, `Toast`, and the three modals (a modal found detached is `dispose()`d first, which releases its `modalLock` hold). Every node the extension injects carries `EXTENSION_OWNED_ATTR`.
- **Page styles changed to fit an injected node are put back.** `injectJSONButton()` records the Inputs heading's previous inline layout and `JsonEditor.stop()` restores it (`restoreHeadings()`); `SettingsLauncher.stop()` does the same for the page title it makes flex; `TitleUpdater.stop()` restores the page's own tab title unless the app changed it since.
- **All three modals build on the `MODAL_*` shell** from `ui/modal.ts` (at least its overlay, dialog, header and footer styles). `SettingsModal` also subscribes to the settings store while open, so a change from another tab repaints its rows.
- **The other worlds follow the same rule.** The PD Inspector content script is `PdEngine` with a `Resolver` and a `Highlighter`; it drops a build that a newer route change has overtaken. The AD Network panel is `AdNetworkPanel`, composed of `InspectedSite`, `MethodCache`, `MethodResolver`, `MethodNames`, `ResolveQueue`, `DetailPane`, `PendingCapture`, `OpenQueue` and `PanelStatus`. The PD Inspector panel is `PdInspectorPanel`; the DevTools page is a `PanelRegistrar` (`panel-registrar.ts`); the options page is `OptionsPage` (`options-page.ts`); the background is `ContentScriptSync`, `MessageRelay` and `CommandHandler`. Each entry file (`panel.ts`, `index.ts`, `devtools-page.ts`) only constructs and starts its classes, so they can be tested without side effects (`tests/devtools/ad-network-panel.test.ts`, `tests/devtools/pd-inspector-panel.test.ts`, `tests/options/options-page.test.ts` and `tests/background/relay.test.ts` drive them, and call `stop()` so no timer outlives them).
- **Same lifecycle contract everywhere.** `PdEngine`, `Highlighter`, `AdNetworkPanel`, `DetailPane`, `PendingCapture`, `ResolveQueue`, `OpenQueue`, `PdInspectorPanel`, `PanelRegistrar`, `OptionsPage`, `SettingsLauncher` and the background classes all have `start()` / `stop()` (`ResolveQueue`, `OpenQueue`: `stop()` only), safe to call twice, with `stop()` removing every listener, interval and timer `start()` added. Constructors only store references: `AdNetworkPanel` reads the inspected origin, site list and cache in `start()`; `PdInspectorPanel` and `OptionsPage` look up their elements (and the inspected tab) in `start()`; `DetailPane` wires its buttons in `start()`; `Highlighter` listens to scroll/resize only between `start()` and `stop()`; and `PdEngine` starts it only after its page-context check. Watchers return their unsubscribe function (`watchFocusFlag`, `InspectedSite.watchSiteConfig`). Async work that can outlive a `stop()` carries a generation check (`PendingCapture.poll`, `ResolveQueue.flush`, `OpenQueue` and the AD Network row actions, the panels' loads, `OptionsPage.refresh`). `PanelRegistrar.stop()` stops watching only: DevTools cannot remove a panel. Both panels also stop themselves on `pagehide`, so closing DevTools undoes what they did to the page; `AdNetworkPanel.stop()` also writes the method cache at once rather than on its debounce timer.

### Settings, selectors, timings: one place each

- **Settings.** `src/config/settings.ts` is the only list of settings. Each entry gives its label, description, default, allowed values and the Settings-modal section (`features`, `ide`, `advanced`). The `Settings` type, `DEFAULT_SETTINGS`, validation (`sanitizeSetting`) and the modal's rows are all derived from it. To add a setting, add one entry there. `designer/core/settings.ts` only holds the page's live copy and keeps it in step with `chrome.storage`.
- **Host-page selectors.** Every selector that reads the designers' own markup is in `src/config/selectors.ts`, grouped by area (`HEADER`, `AD`, `PD`, `AD_INPUTS`, `AD_WIDGETS`, `AD_SCOPE`). A list means "try in order, first match wins" (`firstMatch()` in `designer/utils/dom.ts`). The extension's own ids and classes are not there: they are built with `ns()` next to the code that creates them.
- **Timings.** Waits tuned against the designers' rendering (widget polls, pauses after clicks, first-try delays, `rearmDelays`, `pdRoutePoll`, `jsonButtonThrottle`) are in `src/config/timings.ts`, together with numbers two worlds must agree on (`panelFocusFlash`, which `FocusFlash` in `devtools/view.ts` also hands to the panels' CSS animation as `--focus-flash-ms`; `pdInspectHeartbeat` / `pdInspectTimeout`) and the AD Network lookup retry schedule (`resolveRetry`). Timings of the extension's own UI (hover grace, Esc Esc window, the IDE's discard window) stay next to their code.
- **Names.** Everything the extension adds to a shared world carries the one `belz` prefix from `config/namespace.ts`: DOM ids, classes and data attributes (`ns()`, `nsAttr()`), globals in the inspected page (`PAGE_GLOBALS`), message keys (`COMMAND_MESSAGE_KEY`, `HOSTS_MESSAGE_KEY`, `AUTOFILL_MESSAGE_KEY`) and the autofill fragment marker. The storage keys in `config/storage-keys.ts` keep their `sdExtension…V1` names: renaming them would lose every user's stored settings and sites.

### Logging

All console output goes through `createLogger(scope)` from `src/shared/logger.ts`: `log.debug/info/warn/error`, printed as `[belz:<scope>] …`. Warnings and errors always print; debug and info print only while the **Debug Logging** setting is on (Settings modal → Advanced). Each JavaScript world follows that setting through `chrome.storage`. `tests/shared/logger.test.ts` fails if any other file calls `console.*`. Code injected into the inspected page (`pending-capture.ts`, the token scan in `api.ts`) runs without extension APIs and does not log.

## Trust boundaries

The extension runs in pages it does not control, so every world checks what reaches it:

- **Allowed sites only.** Content scripts are registered only for granted https hosts. The AD Network panel acts on the inspected page only while `InspectedSite.isAllowed` (https, granted host): otherwise it looks up no names, lifts no auth, runs no token scan and keeps no fetch wrapper in the page. DevTools stays open across navigations, so this is re-checked on every `onNavigated` and site-list change. From a navigation until `detect()` answers for the new page the origin is unknown (`InspectedSite.forget()`), so nothing is allowed in between: no name lookup, no header harvest, no wrapper.
- **Messages.** Every receiver checks the sender (`isFromExtension()`; `isFromExtensionPage()`, which also requires no tab and a URL on the extension's own origin; `isFromOptionsPage()`, that page at `OPTIONS_PAGE`; all in `shared/messages.ts`) and the whole message shape (`isPdCommand()`, `isPdRelay()`, `isHostsEdit()`, `isTakeAutofill()`, `isOpenSettings()`). `ContentScriptSync` accepts a `HostsEdit` only from the options page. `MessageRelay` forwards PD commands only from the extension's own pages, and opens only https URLs on granted hosts. Every allowed-site check goes through `isAllowedUrl()` in `shared/hosts.ts`.
- **Page text is data.** Names read from the page or the platform are escaped before they go into HTML (`shared/rich-link.ts`); the panels build DOM with `textContent`.

## Runtime host management

1. The manifest has no `host_permissions` at all, only `optional_host_permissions: ["https://*/*"]`: a site can only ever be granted over https, one at a time.
2. **Only the background writes the list** (`chrome.storage.local[sdExtensionHostsV1]`): `ContentScriptSync` (`src/background/content-scripts.ts`) runs every change to it, and every reconcile, one at a time in one queue (`enqueue()`), so no two of them read-modify-write it at once. `options.html` is the user-facing surface (logic in `OptionsPage`, `src/options/options-page.ts`): it asks the browser for a permission (or removes one) from the user's gesture and then sends the change as a `HostsEdit` message. Add a host: `chrome.permissions.request({ origins: [hostPattern(host)] })` (`https://<host>/*`) from the submit gesture and, on grant, an `add` edit, which the background refuses unless the browser holds the permission. **Grant** on a listed row does the same. The designer host is a `designerHost` edit.
3. `ContentScriptSync` listens for `chrome.storage.onChanged` on that key, and reconciles after every edit and grant sync too: `chrome.scripting.registerContentScripts` — three registrations per host (AD, PD, PD-Inspector) with stable IDs (`ad-<host>`, `pd-<host>`, `pdi-<host>`). A reconcile waits for the task running; requests arriving meanwhile are coalesced into one more pass that reads the list afresh. A "Duplicate script ID" (a stale view of what is registered) is recovered from by registering each script alone and updating the one that exists. Every step's failure is logged; none is left unhandled.
4. `chrome.runtime.onStartup` / `onInstalled` also trigger a reconcile so the registrations are restored on browser start / extension update.
5. Revoke: `OptionsPage` calls `chrome.permissions.remove` from the click; if the browser refuses, nothing changes. Otherwise it sends a `revoke` edit, and the background drops the entry in place (the others keep their order; it refuses while the browser still holds the permission), and its reconcile calls `chrome.scripting.unregisterContentScripts` for the host. The grant sync the removed permission triggers (item 8) runs in the same queue, so whichever comes first, the entry ends up gone and nothing brings it back.
6. **Seeding.** Uninstalling an extension clears its storage, and a Firefox temporary add-on is uninstalled on every reload — so the host list would be lost on each rebuild. If a `sites.default.json` is present in the extension root (gitignored; see `sites.default.json.example`, copied into both trees by `pack.mjs`), `chrome.runtime.onInstalled` restores the list from it when storage has no host key at all. Seeded hosts go through `normalizeHost()` like typed ones; invalid ones are dropped. An explicitly emptied list stores `{hosts: []}` and is therefore never re-seeded.
7. **Entries must carry a boolean `enabled`.** `readHosts()` drops any stored entry without a string `host` and a boolean `enabled`.
8. **Grant state is read from the browser, not storage.** Seeded entries are written `enabled:false, seeded:true` — a permission cannot be restored without a user gesture. `ContentScriptSync.syncGrants()` (`background/content-scripts.ts`) asks `chrome.permissions.contains` for every host (`readGrants()`, `shared/hosts.ts`) and stores each `enabled` flag as the browser reports it (a granted seeded entry loses `seeded`). It runs, in the same one-at-a-time queue as the edits and reconciles, on `chrome.permissions.onAdded` / `onRemoved`, on startup and on install, so a host revoked in the browser's own settings loses its content scripts at once, with the options page closed. `OptionsPage.refresh()` asks the browser too (`readGrants()`, read-only) on each render and subscribes to the same permission events to repaint, so a revoked host shows a **Grant** button rather than a stale Revoke.

## JSON sync engine (the most fragile piece)

- `designer/features/json-editor/extractor.ts` walks the AD Inputs DOM via the `AD_INPUTS` selectors in `config/selectors.ts` to produce a `{ key, value, type, control }` set.
- `designer/features/json-editor/values.ts` (pure, no DOM) validates and normalizes each incoming JSON value against the input's declared type — Text / Number / Integer / Boolean / Date / DateTime / Json / Array / Map / StructuredData — before anything touches the page.
- `designer/features/json-editor/sync.ts` writes the normalized values into the page. Plain inputs and textareas (structured-data ones included, written as plain text) get a native write, events, and a read-back check. Special controls:
  - boolean `exp-select`
  - date pickers (programmatic calendar navigation + model event dispatch). `pageCalendarTo()` pages month by month and reports failure (no day is clicked) when the target month never shows: an unreadable label, a missing arrow, arrows that stop moving, or more than 60 months away.
- The structured-data special case is on the read side: when a StructuredData input's textarea shows `[object Object]`, `extractor.ts` reads its value from the step's default-value textarea (`AD_INPUTS.structuredDefault`) instead.
- Sync result (`SyncResult` in `sync.ts`): `{ success, message, errors, warnings, filledCount, skippedMissingKeys, failedKeys }`.
- The JSON button is placed by `injectJSONButton()`: at most one search per `TIMINGS.jsonButtonThrottle`, over a bounded number of text nodes, and only an element whose whole text is the heading ("Inputs", "2 Inputs") qualifies, never the extension's own markup.

## DevTools panel (AD chain inspector)

Two capture pipelines feed the panel:

1. **`chrome.devtools.network`** (in `network-panel.ts` — the completed-request feed).
   - `onRequestFinished` streams live completions.
   - `getHAR()` is called once on init to backfill anything captured before the user first opened our panel tab. Entries are keyed by `url + startedDateTime` for dedup.
   - `src/devtools/ad-network/extract.ts` classifies chain URLs and parses method definitions (`definitionOf()`, `nameFromDefinition()`, shared with `api.ts`).
2. **`src/devtools/ad-network/pending-capture.ts`** (the in-flight feed), on allowed sites only.
   - Injects a fetch + XMLHttpRequest wrapper into the inspected page via `chrome.devtools.inspectedWindow.eval`.
   - The wrapper keeps its state in the one page global `PAGE_GLOBALS.capture`: the page's originals, whether it is active, and a map of live AD chain requests. The panel polls ~2× per second (`READ_SCRIPT`) and renders each entry as a pending row that disappears on completion.
   - `stop()` (the panel leaving an allowed site, navigating, or stopping) runs `UNINSTALL_SCRIPT`: originals the page has not replaced since are put back, and the wrapper is switched off either way. The wrapper also retires itself when no poll has come for 10 s (DevTools closed without a `stop()`).
   - A poll that finds no active wrapper installs it again: a new document, or a wrapper that retired itself while a hidden panel's timers were throttled. Installing is idempotent per page context; over a wrapper that could not put everything back, it wraps again what was put back and switches it on.
   - Every install (`wrapperScript(origin)`) is for the origin the panel found allowed when it started the capture, and the script checks `location.origin` (https, that origin) in the same evaluation before it wraps anything, so a poll answered between a navigation committing and `onNavigated` never wraps a page that has not been checked.

### Name / category / designer-URL resolution

The extension is **self-contained** — it depends on no local service, CLI, or third-party API. Everything it needs about a method it reads from the inspected instance itself:

1. `InspectedSite` (`origin.ts`) resolves two origins and the allowed-site check. `apiOrigin` is the inspected window's own origin. `designerOrigin` is the same unless the user recorded a `designerHost` override for that site on the options page (split public/staff-portal deployments). `isAllowed` is true only for https on a granted host. No host mapping is hardcoded.
2. `MethodResolver` (`api.ts`) calls `GET /rest/api/automation/chain/v2/<uuid>?basicInfo=false` on `apiOrigin`, falling back to the V1 path on non-auth errors, and normalises both shapes to `{ name, category, state, referenceId }` (`state` null when the document does not give it: never assumed). It refuses (a `final` `ApiError`) when the page is not on an allowed site. The designer URL is then `designerOrigin + /automation-designer/<category>/<draftUuid>`: a `DRAFT` opens its own uuid, a `PUBLISHED` method its `referenceId` (the linked draft). With no category, an unknown state, a published method without a `referenceId`, or no known origin there is no URL: nothing is guessed, and the row action says why (`noDesignerUrlReason()`). Requests use `redirect: 'error'`, so the auth headers never follow a redirect to another origin.
3. Auth reuses what the page already has, **per origin**: the `Authorization` / `Expertly-Auth-Token` header lifted off an observed chain request (kept for that request's origin only, and only on allowed sites); else the page's sign-in token from a scan of its storage — `localStorage.authToken` first (the AD key, possibly JSON-quoted), then the first JWT in local or session storage. The scan reports the origin it ran on, and the token is used only for that same origin. A failed scan is not remembered. A 401/403 with remembered credentials drops them and retries once with fresh ones. Cookies (`credentials: 'include'`) go with every call. `forgetAuth()` drops everything; the panel calls it on every navigation, before anything else can use the old site's credentials.
4. `MethodCache` (`cache.ts`) memoises results in `chrome.storage.local` under `sdExtensionAdCacheV1`, keyed `<origin>|<uuid>`. Fresh for 6h, stale-but-served (with background revalidation) to 14d, capped at 800 entries with oldest-first eviction. Several DevTools windows share the stored map, so a flush writes only this panel's changed entries, merged into what is stored now (newest entry wins per key). Only a lookup's answer is ever written, so every entry is served, one without a category or state included: it is not asked for again. A name read from a definition-fetch body is only shown (`MethodNames`), never cached.

`ResolveQueue` (`names.ts`) batches resolves behind a 250 ms debounce with a concurrency of 4. A uuid whose lookup failed in a way `isRetryableError()` (`api.ts`) says may clear by itself — unreachable host, 401/403, a transient status (`isTransientStatus()` in `shared/retry.ts`: 408/429/5xx), or no HTTP status (a non-JSON login page) — is queued again with backoff (`TIMINGS.resolveRetry`: 4 s, doubling, at most 60 s) and given up after 5 failed lookups. Any other HTTP error (a 404 on both V2 and V1), a `final` error, and a null summary are final for that uuid.

### "Open in draft" autofill

The row action (`OpenQueue` in `open-draft.ts`, one click at a time) opens the method's draft designer page in a background tab and fills its test inputs with the captured request body, without ever putting the body in a URL:

1. The panel stores the body with `storeHandoff()` (`shared/autofill-handoff.ts`) in `chrome.storage.session` under `AUTOFILL_HANDOFF_KEY_PREFIX` + a random 32-hex id, and opens `<designer URL>#belz-autofill=<id>`.
2. On that page, `startCurlAutofillFeature()` (`designer/features/curl-autofill/`) removes only its own marker from the fragment (keeping the query, the rest of the fragment and `history.state`) and asks the background for the body (`TakeAutofillMessage`).
3. `MessageRelay` answers only this extension's content script on an Automation Designer page of a granted https host, with `takeHandoff()`: the body is removed as it is read, and ignored if older than 5 minutes. Takes run one at a time in the relay, so two requests for one id cannot both get the body. A copied, reopened or forged link therefore fills nothing. The designer host must itself be an allowed site, or no content script runs there.

Cross-browser caveat: Firefox can't access `chrome.tabs` from a DevTools script directly, so `background/relay.ts` relays messages between the PD panel and the target tab.

Focus-hint shortcut: `Ctrl+Shift+A` / `Ctrl+Shift+P` fire background `chrome.commands` — neither Chrome nor Firefox exposes an API for extensions to open or switch DevTools panels, so `CommandHandler` writes a flag in `chrome.storage.session` (`shared/focus-flag.ts`) and each panel reacts (scroll+pulse+focus for AD, refetch+pulse for PD) when the flag targets it. A flag written up to 60 s before the panel loads is still honoured.

## PD Inspector

Answers one question on a published page: *which Page Designer components are on it, and which one owns this piece of the UI?* Two halves, with very different certainty.

- **Component tree — exact.** `config.ts` fetches the page's compiled config from the deployable endpoint, then every PD component it embeds, recursively. A component reference is a childless `isSymbol` node. `component-tree.ts` assembles the nesting from configs alone, never the DOM, so it is always right. A page can render inside an **app shell**: a separate PAGE, looked up by the first path segment, whose layout contains a `router-outlet` node. The shell is where navbar and sidebar come from. When one exists, the content page is spliced in at the outlet. Only the config's outlet counts: the rendered page also contains Angular's own `<router-outlet>` elements.
- **Inspect mode — anchored, not guessed.** The runtime does not mark component boundaries in the DOM, but a config node's static `props.className` survives onto its rendered element. `resolve.ts` pins elements to config nodes by className: one node and one element is exact; several of each are paired in document order only when the counts agree, and refused otherwise, because a wrong anchor shadows the right one further up. Hovering an element climbs to the nearest anchored ancestor. The panel shows how many nodes were anchored.
- **Inspect mode never outlives the panel.** It swallows the page's clicks, so while it is on the panel re-sends `setInspect` (`on: true`) every `TIMINGS.pdInspectHeartbeat` (a constructor argument, so a test can shorten it), and the engine leaves inspect mode by itself after `TIMINGS.pdInspectTimeout` without one. The panel also sends `setInspect: false` before Refresh, the focus shortcut, a route-change reload, and from `stop()` (run on `pagehide`). The Inspect button shows what the engine answered, not what was asked.
- **Wiring.** The panel (`PdInspectorPanel`, `devtools/pd-inspector/inspector-panel.ts`) calls the engine through the background relay, because Firefox gives DevTools panels no `chrome.tabs`. The engine accepts commands only from this extension, and pushes messages back with `chrome.runtime.sendMessage` (`PdPushMessage` in `shared/messages.ts`): inspect-mode picks, and `routeChanged`. The panel ignores pushes from other tabs and other extensions. All messages carry `ns: 'pd'`. Published pages are SPAs, so the engine polls the path every `TIMINGS.pdRoutePoll`; on a change it leaves inspect mode, drops any in-flight build (the generation is bumped even when the new path is not a published page, which then reports an error state instead of the old model), and pushes `routeChanged`, on which the panel resets its Inspect button and reloads. Page Designer's config vocabulary (outlet, form-field and button node names) is in `PD_CONFIG_NODES` in `config/selectors.ts`.

## Textarea overlay (opens the IDE; performance-critical)

`designer/features/ide/index.ts` injects **one** controls element for the whole page, positioned over whichever textarea has pointer or keyboard focus. Do not reintroduce per-textarea DOM.

- Hover/focus is handled by capture-phase delegation on `document`, using `event.composedPath()[0]` so open shadow roots resolve to the real inner target. A textarea added later therefore needs no registration and no rescan — this feature deliberately does **not** subscribe to the MutationObserver.
- Read-only and **disabled** textareas qualify, so a PUBLISHED AD method gets the overlay too. The modal refuses to write back to a read-only source (`IdeModal.showSource()` disables Save).
- A `disabled` control dispatches no pointer events: the browser retargets the hover to its nearest enabled ancestor, so delegation never sees the textarea. `resolveTarget` therefore also receives the originating **event** and hit-tests `document.elementFromPoint`, which is not suppressed the same way. `output-copy` runs the same hit test so the two overlays never both claim one pointer position.
- Repositioning is coalesced through `requestAnimationFrame` with a 32 ms `setTimeout` backstop, because rAF is suspended in backgrounded tabs and headless rendering; without the backstop the overlay can linger over the wrong element.
- The page's own markup is never restructured: wrapping each textarea in extra DOM forces a layout pass over all of them and makes the extension a source of the very mutations it reacts to.

If you change the overlay, keep it at one controls element with no per-textarea DOM and no `pageObserver` subscription, and run `tests/designer/ui/hover-overlay.test.ts` and `bun run test:e2e` (which checks the overlay on a normal and a disabled textarea in Chromium and Firefox).

## IDE keys

In `ide/modal.ts`, one `keydown` listener on `window`, capture phase, handles `Esc`, `Ctrl/Cmd+S`, `Ctrl/Cmd+F` and `Shift+Alt+F` (Format; matched on `event.code`, because Option changes the character on a Mac), and only while the IDE is the topmost modal. It runs before every listener on the document and below, and before window-capture listeners added after the IDE first opened; a key it handles gets `preventDefault()` and `stopImmediatePropagation()`, so neither the page's shortcuts nor the browser's Save page / Find act on it. `Esc` steps aside while CodeMirror has its completion list or search panel open (`completionStatus()`, `searchPanelOpen()`), so CodeMirror's own `Esc` closes those first. `Esc` and a click on the backdrop close alike (`closeOrAskFirst()`): with unsaved changes, the first shows a prompt in the footer and a second (either) within `DISCARD_WINDOW_MS` discards; an edit in between withdraws the prompt. **Cancel** and **×** close without asking. No `window.confirm`.

## IDE Format

`IdeModal.format()` (the header's **Format** button and `Shift+Alt+F`) formats SQL and JSON only (`isFormattable()` in `ide/language.ts`); in other modes it only says so in the footer. The formatter, `ide/format.ts` with `sql-formatter` (an exact-pinned dependency; `formatDialect` + the `postgresql` dialect only), is its own chunk, loaded by `import('./format')` on the first Format. The result is one CodeMirror transaction (`userEvent: 'format'`, one undo) over the selection or the whole text, none when nothing changes; errors leave the text alone and show in the footer. AD syntax is protected, never guessed at: in SQL each `#{ … }` becomes a unique identifier token during formatting and every token must come back exactly once, `:name` / `$1` are declared parameters; JSON is validated with `JSON.parse` (bare placeholders standing in as `""`) and re-laid out from its own tokens, so numbers and escapes are copied, not re-serialised. A read-only source can be formatted for reading; it never counts as unsaved. Details in [`src/designer/features/ide/README.md`](src/designer/features/ide/README.md).

## IDE `#{variable}` intellisense (AD only)

The IDE completes, explains and lints `#{variable}` references. It knows which variables exist from the **live page DOM**, never the chain API, so unsaved draft edits (a step just added, a renamed output) count and no auth is needed.

- **Scanner** (`designer/features/ad-scope/scan.ts`, `scanScope(root, textarea)`): pure, AD-only, no state. Two `querySelectorAll` calls, one per group. It runs on **every** IDE open (`Ide.scopeFor`), never cached across opens, never per keystroke, no MutationObserver.
- **DOM contract** (`AD_SCOPE` in `config/selectors.ts`, verified on a live AD page):
  - Inputs and internal variables: `#step2 .fieldCode`, text `Field Code: #{name}`. Inside `.INTERNAL_LIST` it is an internal variable, otherwise (`.INPUT_LIST`) a method input.
  - Steps: `exp-sd-step-three` with id `step3_<index>` (0-based; the UI labels it `3.<index+1>`).
  - Step outputs: `exp-sd-step-three[id^="step3_"] div._input-value > div.mt1.font-size-smallest`, text `Field Code : #{name}` (space before the colon).
  - Both texts are parsed with `/Field Code\s*:\s*#\{([^}]+)\}/`.
  - The edited step is `textarea.closest('exp-sd-step-three[id^="step3_"]')`; none means "outside steps".
- **Scoping.** Inputs and internal variables are always in scope. Outputs of steps before the edited one are in scope; outputs of the edited step and later ones are not (never offered in completion; flagged by the linter if typed by hand). Outside any step, everything is in scope. A name is listed once: an output written into a declared variable stays the variable; an output of several steps keeps the earliest. Loop sources are not in the DOM, so `element` is offered after `#{name.` for any name in scope.
- **IDE side** (lazy chunk): `ide/scope.ts` is the type-only contract (`ScopeVariable`, `VariableScope`, `ScopeProvider`). `references.ts` is pure string logic (finding `#{ … }` with nested braces and string literals, lint, hover lookup, labels, footer status). `variables.ts` wires it into CodeMirror: a completion source prepended to every mode's override list (for Java/Python, whose own completion comes from language data, it is added as language data; JSON/plain get an `autocompletion()` with just this source), a `hoverTooltip`, and a `linter` (`@codemirror/lint`). Completion triggers after `#{` (inserting `name}` unless a `}` already follows) and on bare names inside an open `#{ …` (SpEL). The footer shows e.g. `Step 3.4 · 12 variables in scope`.
- **Lint is conservative.** Only simple `#{name}` / `#{name.path}` forms are checked: unknown root name, output of a later step, plus any unclosed `#{`. Complex SpEL, `T(…)`, `#this`, literals and keywords are left alone, and unknown-name warnings are suppressed when the scan found no variables at all (a page whose markup changed produces no noise).
- **Setting:** `ideIntellisense` (ide section, default on). Off, or on PD pages, the IDE opens with no scope: no completion, hover, lint or status for variables. Read-only sources get it too (display only; Save stays disabled).

## Content-script module graph (lazy IDE)

The IDE modal (`designer/features/ide/modal.ts`) carries CodeMirror and every language mode, ~610 KB (with `@codemirror/lint` for the variable linter). It is reached only through `import('./modal')` in `ide/index.ts`, and fetched on the first **Open** click (then cached; a reopen takes ~50 ms). A page load parses about 53 KB on AD pages and 50 KB on PD pages; `tests/build/bundle.test.ts` keeps it under 100 KB.

How it fits together:

- `dist/ad-content.js` and `dist/pd-content.js` are **generated loaders**, written by `build.mjs`. Content scripts cannot be ES modules, so each loader just `import()`s the real entry from `dist/modules/`. They keep the paths `background/content-scripts.ts` registers.
- `dist/modules/` is one `bun build --splitting` over both entries (`src/designer/ad-content.ts`, `src/designer/pd-content.ts`): the entries, shared chunks, and the lazy IDE chunk (`chunk-<hash>.js`). `build.mjs` wipes `dist/` first so a stale hashed chunk can never ship.
- `manifest.json` lists `dist/modules/*` in `web_accessible_resources`. **This is required**: without it both Chromium and Firefox refuse the import (verified).

**The rule that must not be broken: one `--splitting` call, never a separate build for the IDE.** `modal.ts` imports `core/settings`, `ui/modal-lock`, `ui/toast` and the settings modal — module-level singletons. Built separately, the chunk gets its own copies, and in both browsers the IDE then still opens and looks perfect, but `Ctrl+Shift+Enter` fires Run Test *behind the open IDE*, because the shortcut checks a different copy of the modal lock. One graph makes the shared modules shared chunks, loaded once per page.

**This rule is enforced.** `scripts/check-singletons.mjs` runs at the end of every build and fails it if any stateful module is bundled more than once into the designer content scripts. Each stateful module starts with a marker, `/*! belz-singleton: designer/core/settings */`. It is a "legal" comment, so the minifier keeps it and it travels with the module into whichever output file holds it. Each marker must then appear in exactly one designer output file. The check also scans `src/designer/`, `src/config/` and `src/shared/` for top-level state and fails on any such module that has no marker, so a new stateful module can't slip past unprotected. A line counts as state when, at the start of the line (optionally after `export`), it declares a `let` or `var`; or declares a `const` whose name is not SCREAMING_CASE and assigns it `new` of a capitalised constructor (`new Set(…)`, `new Map(…)`, `export const settings = new SettingsStore(…)`; a SCREAMING_CASE `const DATE_TYPES = new Set(…)` is a constant table and is exempt); or is `export const state =`, whatever it is assigned. Indented lines are not checked (the regex is `STATEFUL_RE` in the script). When it fails, the message names the module and files, or the exact marker line to add. Each of these ways of breaking the rule fails the build, including through `pack.mjs`: the IDE added as a standalone entry, a separate bundle dropped into `dist/modules`, a marker stripped from the output, a marker deleted from the source, and a new unmarked module. Output files that run in a different JavaScript world (background, options, DevTools pages, `pd-inspector.js` from `src/pd-inspector-page/`) are excluded by an explicit, reasoned list in the script. Do not add a file there to make the check pass.

The IDE chunk itself lazy-loads one more chunk, the formatter (`ide/format.ts` + `sql-formatter`, ~75 KB), on the first Format; it shares the small `references.ts` chunk with the IDE and holds no state.

To lazy-load something else, just use `import()` inside a module in this graph; the bundler handles the rest. Anything reached by a **static** import is eager. To check what a page load costs, walk the static-import closure of `dist/modules/ad-content.js`, not file sizes.

## Known risks

- **DOM coupling is high.** Selectors in `src/config/selectors.ts` depend on the AD/PD UI's current class names. When the UI changes upstream, these break first.
- **Inline styles in modals.** Heavy use of inline style strings — refactors here are noisy; keep them confined.
- **Date picker / select internals.** AD's custom controls dispatch synthetic events on internal state changes; sync.ts has hand-tuned event sequences.
- **`dist/modules/*` is web-accessible on every `https://` page.** That is what lets a content script import it, but it also lets any https page request those files by URL. In Chromium the extension ID is stable, so a page that knows it could detect the extension is installed. (Firefox uses a random per-install UUID, so it cannot.) The files contain no secrets. `use_dynamic_url` would close this in Chromium but has not been tested.

## Safe-change checklist

1. After selector edits, smoke test on a real AD page and a real PD page.
2. After `sync.ts` changes, exercise boolean / date / structured-data paths manually.
3. After manifest changes, validate both Chromium (`build/chrome/manifest.json`) and Firefox (`build/firefox/manifest.json`) outputs from `scripts/pack.mjs`, and update `tests/build/manifest.test.ts` and the root README's "Privacy and permissions".
4. After adding a new entry point, update `manifest.json`, `scripts/build.mjs`, `scripts/pack.mjs` SHARED list (if you're adding an HTML surface), `config/extension-files.ts` (if other code names its path), and the layout tree in "Layout" above. A new **content script** that shares code with AD/PD belongs in the split graph (`splitEntries` in `build.mjs`), not as a standalone bundle.
5. Rebuild `dist/` before shipping any change that touches `src/`.
6. When adding a hardcoded string that looks like a URL, path, storage key, or DOM identifier — put it in `src/config/` instead of inlining. Grep for existing entries there before adding a new file.
7. A new message: declare its shape and a whole-shape guard in `shared/messages.ts`, and check the sender where it is received.

## Maintainer Agent contract

When you make a meaningful change — new feature, changed selectors, sync behavior, manifest scope, file layout — update this `AGENTS.md` in the same commit.

Documentation lives at three levels, all kept current in the same commit as the code:

- **`README.md` (root)** is the user guide: what the extension does, how to install, set up and use it, and development basics. It describes the extension as it is now; it is never a changelog.
- **A `README.md` in every directory** explains that directory: what it is for, what each file does, how it connects to the rest, its local conventions and how to change it. Adding, removing or renaming a file or folder means updating the README of the folder it is in (a new folder gets its own README). The template is the existing ones; parents stay a map, leaves carry the detail.
- **This `AGENTS.md`** holds the repo-wide rules and the cross-cutting design (build graph, lifecycle contract, fragile areas). Directory READMEs link here rather than repeat it.
