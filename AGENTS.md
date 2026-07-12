# AGENTS.md — belz-extension

You are the Maintainer Agent for this browser extension. This file is the canonical map of the codebase and the contract for keeping it accurate.

## Purpose

A browser extension that augments Automation Designer (AD), Page Designer (PD), and the DevTools layer of Service Designer's web UI with productivity tooling for engineers.

## Tech & runtime

- Plain JavaScript (ES modules) — no TypeScript, no React.
- Manifest V3 (`manifest.json`).
- Build: `bun build` (see `scripts/build.mjs`) per entry point, then `scripts/escape-non-ascii.mjs` for extension-loader compatibility.
- Per-browser packaging: `scripts/pack.mjs` assembles `build/chrome/` and `build/firefox/` trees, the second adding `browser_specific_settings.gecko` for AMO signing.
- Targets: **runtime-editable** — the manifest ships with only `localhost:65535` as a static host_permission; the user's granted hosts live in `chrome.storage.local` under `sdExtensionHostsV1` and are managed via the options page. `src/background.js` reconciles `chrome.scripting.registerContentScripts` against that list.

## Entry points

```
src/ad-content.js        injected on /automation-designer/* (per-host, runtime)
src/pd-content.js        injected on /ui-designer/*         (per-host, runtime)
src/pd-inspector.js      injected on /pages/*               (per-host, runtime)
src/background.js        script registrar + focus-command listener + PD relay
src/options.js           options page (user-editable host list)
src/devtools/
  devtools-page.js       DevTools entry (creates panels)
  panel.js               AD Network chain inspector panel (thin wiring)
  panel-pd.js            PD Inspector DevTools panel
  extract.js             classifyChainUrl + body-parser (pure helpers)
  ad-env.js              env resolution + host→env mapping
  pending-capture.js     fetch/XHR wrapper for in-flight AD chain requests
  json-tree.js           collapsible JSON view for the detail pane
```

`manifest.json` and the per-browser manifest writes in `scripts/pack.mjs` are the source of truth for paths — keep them in sync with the entry list above when adding/removing entry points.

## Source layout

```
src/
  config/
    constants.js               DOM selectors, observer config, feature flags
    routes.js                  /automation-designer/, /ui-designer/, /pages/
    endpoints.js               CHAIN_PATH_RE, PD_DEPLOYABLE_PATH, BELZ_WEB_*
    storage-keys.js            SETTINGS/HOSTS/FOCUS storage keys
    namespace.js               EXT_PREFIX + ns() helper for DOM identifiers
  core/
    bootstrap.js               wires features into start/stop lifecycle
    settings.js                feature toggles + textarea defaults (chrome.storage.local)
    state.js                   mutable app state
    logger.js                  prefixed console wrapper
    observer.js                MutationObserver wrapper
  features/
    title-updater/             page title rewriter
    keyboard/                  shortcut handler (Ctrl+Shift+Enter)
    run-test/                  Run Test button lookup + click
    json-editor/               📋 JSON modal: extractor, sync engine, type adapters
    output-copy/               hover-revealed output copy icon
    textarea-editor/           overlay icons + CodeMirror modal editor
    pd-inspector/              deployable page config walker
    curl-autofill/             cURL → AD inputs autofill
    settings/                  ⚙ settings modal
  ui/
    modal.js                   modal frame
    modal-lock.js              page interaction lock while a modal is open
    toast.js                   transient notifications
    styles.js                  shared inline-style helpers
    theme.js                   palette + font/radius/shadow tokens (vendored)
  utils/
    dom.js                     selectors, manipulation helpers
    clipboard.js               clipboard.writeText with fallback
```

## Build & release

| Command | Purpose |
|---|---|
| `bun install` | install dependencies |
| `bun run build` | bundle every entry point to `dist/`, escape non-ASCII |
| `bun run dev` | watch-mode (content scripts + DevTools panel) |
| `node scripts/pack.mjs` | per-browser trees in `build/chrome` and `build/firefox` |

A `v*` tag pushed to the remote triggers `.github/workflows/release.yml` — see README.md for the full flow + required secrets.

## Feature flow (AD/PD)

1. On load, the content script reads persisted settings and starts only the features marked enabled.
2. Each feature module exports `start()` / `stop()` and registers a MutationObserver if it needs to react to DOM changes.
3. Settings UI (`Ctrl + ,`) toggles features in real time and persists to `chrome.storage.local`.

## Runtime host management

1. The manifest ships only `http://localhost:65535/*` (belz web) in `host_permissions`, plus `optional_host_permissions: ["*://*/*"]`.
2. `options.html` is the user-facing surface — add a host, we call `chrome.permissions.request({ origins: [\`https://${host}/*\`] })` from the submit gesture and, on grant, write the host into `chrome.storage.local[sdExtensionHostsV1]`.
3. `src/background.js` listens for `chrome.storage.onChanged` on that key and reconciles `chrome.scripting.registerContentScripts` — three registrations per host (AD, PD, PD-Inspector) with stable IDs (`ad-<host>`, `pd-<host>`, `pdi-<host>`).
4. `chrome.runtime.onStartup` / `onInstalled` also trigger reconcile so the registrations are restored on browser start / extension update.
5. Revoke reverses everything: `chrome.scripting.unregisterContentScripts` → `chrome.permissions.remove` → storage delete.

## JSON sync engine (the most fragile piece)

- `features/json-editor/extractor.js` walks the AD Inputs DOM via `config/constants.js` selectors to produce a `{ key, value, type, control }` set.
- `features/json-editor/sync.js` normalizes incoming JSON values against each input's declared type:
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
   - `src/devtools/extract.js` classifies chain URLs and extracts the method name from definition-fetch bodies.
2. **`src/devtools/pending-capture.js`** (the in-flight feed).
   - Injects a fetch + XMLHttpRequest wrapper into the inspected page via `chrome.devtools.inspectedWindow.eval`.
   - The wrapper tracks live AD chain requests in `window.__belzADPending`; the panel polls that map ~2× per second and renders each entry as a pending row that disappears on completion.
   - Reinstalled on `chrome.devtools.network.onNavigated`; idempotent per page context.

Env resolution: `src/devtools/ad-env.js` fetches belz web's `/api/envs` and maps the inspected host → env slug. Falls back to hardcoded regex rules when belz web is unreachable.

Cross-browser caveat: Firefox can't access `chrome.tabs` from a DevTools script directly, so `background.js` relays messages between the PD panel and the target tab.

Focus-hint shortcut: `Ctrl+Shift+A` / `Ctrl+Shift+P` fire background `chrome.commands` — neither Chrome nor Firefox exposes an API for extensions to open or switch DevTools panels, so the background writes a session flag and each panel reacts (scroll+pulse+focus for AD, refetch+pulse for PD) when the flag targets it.

## Known risks

- **DOM coupling is high.** Selectors in `src/config/constants.js` depend on the AD/PD UI's current class names. When the UI changes upstream, these break first.
- **Inline styles in modals.** Heavy use of inline style strings — refactors here are noisy; keep them confined.
- **Date picker / select internals.** AD's custom controls dispatch synthetic events on internal state changes; sync.js has hand-tuned event sequences.
- **Console noise.** Bootstrap and JSON flows still log via `core/logger.js`. Levels gate output but the calls remain — review before shipping anything verbose.

## Safe-change checklist

1. After selector edits, smoke test on a real AD page and a real PD page.
2. After `sync.js` changes, exercise boolean / date / structured-data paths manually.
3. After manifest changes, validate both Chromium (`build/chrome/manifest.json`) and Firefox (`build/firefox/manifest.json`) outputs from `scripts/pack.mjs`.
4. After adding a new entry point, update `manifest.json`, `scripts/build.mjs`, `scripts/pack.mjs` SHARED list (if you're adding an HTML surface), and the table at the top of this file.
5. Rebuild `dist/` before shipping any change that touches `src/`.
6. When adding a hardcoded string that looks like a URL, path, storage key, or DOM identifier — put it in `src/config/` instead of inlining. Grep for existing entries there before adding a new file.

## Maintainer Agent contract

When you make a meaningful change — new feature, changed selectors, sync behavior, manifest scope, file layout — update this `AGENTS.md` in the same commit. The README.md is the public-facing version; mention user-facing changes there too.
