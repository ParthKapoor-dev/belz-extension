# AGENTS.md — belz-extension

You are the Maintainer Agent for this browser extension. This file is the canonical map of the codebase and the contract for keeping it accurate.

## Purpose

A browser extension that augments Automation Designer (AD), Page Designer (PD), and the DevTools layer of Service Designer's web UI with productivity tooling for engineers.

## Tech & runtime

- Plain JavaScript (ES modules) — no TypeScript, no React.
- Manifest V3 (`manifest.json`).
- Build: `bun build` (see `scripts/build.mjs`) per entry point, then `scripts/escape-non-ascii.mjs` for extension-loader compatibility.
- Per-browser packaging: `scripts/pack.mjs` assembles `build/chrome/` and `build/firefox/` trees, the second adding `browser_specific_settings.gecko` for AMO signing.
- Targets: NSM dev/qa/uat, YieldSec environments, Verifi-NC staff, demo + inside Expertly clouds. Full list in `manifest.json` `host_permissions` + content script `matches`.

## Entry points

```
src/ad-content.js        injected on /automation-designer/*
src/pd-content.js        injected on /ui-designer/*
src/pd-inspector.js      injected on /pages/*
src/background.js        background (service_worker on Chrome, scripts on Firefox)
src/devtools/
  devtools-page.js       DevTools entry (creates panels)
  panel.js               AD chain inspector panel
  panel-pd.js            PD inspector DevTools panel
```

`manifest.json` and the per-browser manifest writes in `scripts/pack.mjs` are the source of truth for paths — keep them in sync with the entry list above when adding/removing entry points.

## Source layout

```
src/
  config/constants.js          DOM selectors, observer config, feature flags
  core/
    bootstrap.js               wires features into start/stop lifecycle
    settings.js                feature toggles + textarea defaults (chrome.storage)
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

- `src/devtools/extract.js` matches `/rest/api/automation/chain/...` requests, captures request/response bodies, and feeds the panel.
- The panel renders the chain list, JSON tree, and an Execute action that replays the chain with edited inputs (POST to `/rest/api/automation/chain/test/execute/<uuid>` or the non-test variant).
- Cross-browser caveat: Firefox can't access `chrome.tabs` from a DevTools script directly, so `background.js` relays messages between panel and target tab.

## Known risks

- **DOM coupling is high.** Selectors in `src/config/constants.js` depend on the AD/PD UI's current class names. When the UI changes upstream, these break first.
- **Inline styles in modals.** Heavy use of inline style strings — refactors here are noisy; keep them confined.
- **Date picker / select internals.** AD's custom controls dispatch synthetic events on internal state changes; sync.js has hand-tuned event sequences.
- **Console noise.** Bootstrap and JSON flows still log via `core/logger.js`. Levels gate output but the calls remain — review before shipping anything verbose.

## Safe-change checklist

1. After selector edits, smoke test on a real AD page and a real PD page.
2. After `sync.js` changes, exercise boolean / date / structured-data paths manually.
3. After manifest changes, validate both Chromium (`build/chrome/manifest.json`) and Firefox (`build/firefox/manifest.json`) outputs from `scripts/pack.mjs`.
4. After adding a new entry point, update `manifest.json`, `scripts/build.mjs`, and the table at the top of this file.
5. Rebuild `dist/` before shipping any change that touches `src/`.

## Maintainer Agent contract

When you make a meaningful change — new feature, changed selectors, sync behavior, manifest scope, file layout — update this `AGENTS.md` in the same commit. The README.md is the public-facing version; mention user-facing changes there too.
