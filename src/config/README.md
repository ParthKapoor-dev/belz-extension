# `src/config/`

The single home for the extension's constants: the settings schema, the selectors and timings tuned
against the AD/PD pages, routes, endpoints, storage keys and the DOM namespace. Every JavaScript
world (content scripts, background, DevTools pages, options page) imports from here. The modules
hold no state, so each world can safely carry its own copy.

## Contents

| File / directory | What it does |
|---|---|
| [`settings.ts`](settings.ts) | `SETTINGS`: the one list of user settings (label, description, default, allowed values, modal section). `Settings`, `DEFAULT_SETTINGS`, `settingsIn()`, `sanitizeSetting()` and `sanitizeSettings()` are derived from it. |
| [`selectors.ts`](selectors.ts) | Every selector read from the designers' own markup, grouped by area: `HEADER`, `AD`, `PD`, `AD_INPUTS`, `AD_WIDGETS`, `AD_SCOPE`. Also `PD_CONFIG_NODES`, the node names in Page Designer's compiled configs. |
| [`timings.ts`](timings.ts) | `TIMINGS`: waits tuned against the designer pages (widget polls, pauses after clicks, `rearmDelays`, `pdRoutePoll`), plus `panelFocusFlash`, shared by both DevTools panels. |
| [`routes.ts`](routes.ts) | Path prefixes: `AD_ROUTE_PREFIX` (`/automation-designer/`), `PD_ROUTE_PREFIX` (`/ui-designer/`), `PAGES_ROUTE_PREFIX` (`/pages/`). |
| [`endpoints.ts`](endpoints.ts) | Paths on the inspected host: `CHAIN_PATH_RE`, `PD_DEPLOYABLE_PATH`, `chainV2Path()`, `chainV1Path()`, `designerPath()`, `pdPagePath()`, `pdSymbolPath()`, and the `AUTOFILL_PARAM` URL parameter. |
| [`storage-keys.ts`](storage-keys.ts) | `chrome.storage` keys: `SETTINGS_STORAGE_KEY`, `HOSTS_STORAGE_KEY`, `AD_CACHE_STORAGE_KEY`, `FOCUS_STORAGE_KEY`. |
| [`namespace.ts`](namespace.ts) | `EXT_PREFIX`, `ns()` and `nsAttr()` for the extension's own DOM ids, classes and data attributes, and `EXTENSION_OWNED_ATTR`, which marks injected DOM. |

## What belongs here

Put a value here when it is one of these:

- a **user setting** (add one entry to `SETTINGS`; nothing else needs a list of settings);
- a **selector or node name read from the AD/PD pages** (they break first when the designers change);
- a **wait tuned against the AD/PD pages' rendering**;
- a **route, URL path or endpoint** on the inspected host;
- a **`chrome.storage` key**;
- the **namespace** used to build the extension's own DOM names.

The rule: such values are not hard-coded anywhere else. Before inlining a string that looks like a
URL, path, storage key or DOM identifier, grep this folder for an existing entry, and add it here if
there is none. See the safe-change checklist in [AGENTS.md](../../AGENTS.md).

What does **not** belong here:

- The extension's own ids and classes. They are built with `ns()` next to the code that creates them.
- Timings of the extension's own UI (hover grace, the Esc Esc window, toast duration). They stay next
  to their code. `panelFocusFlash` is the one exception, because two panels share it.
- Anything with state. These modules must stay plain constants and pure functions; the build's
  singleton check ([`scripts/check-singletons.mjs`](../../scripts/check-singletons.mjs)) scans this
  folder for top-level state.

## How it connects

- **Used by:** every world. The designer content scripts ([`designer/`](../designer/)) use settings,
  selectors, timings, routes and the namespace. [`pd-inspector-page/`](../pd-inspector-page/) uses
  `PD_CONFIG_NODES`, `PD_DEPLOYABLE_PATH`, `PAGES_ROUTE_PREFIX`, `TIMINGS.pdRoutePoll` and `ns()`.
  [`devtools/`](../devtools/) uses the endpoints and `panelFocusFlash`. [`background/`](../background/)
  and [`shared/`](../shared/) use routes and storage keys.
- **Depends on:** nothing outside this folder. `endpoints.ts` imports `routes.ts`.

## Conventions

- A selector list means "try in order, first match wins" (`firstMatch()` in `designer/utils/dom.ts`).
- Storage keys carry a `V1` suffix. Changing a stored shape incompatibly means a new key.
- Group selectors by the page area that owns them, and say in a comment what the selector finds.

## Testing

[`tests/config/settings.test.ts`](../../tests/config/settings.test.ts) covers the settings schema,
`sanitizeSetting` and `sanitizeSettings`. Selectors are exercised by the designer feature tests under
[`tests/designer/`](../../tests/designer/). To run the tests, see the root
[README](../../README.md#development)'s Development section.

## Adding or changing things

- **A new setting:** add one entry to `SETTINGS` with `toggle(...)` or `select({...})`. The type,
  default, validation and settings-modal row follow from it. Then read it where the feature starts.
- **A selector broke after a designer release:** fix it in `selectors.ts`, or add a fallback to its
  list, then smoke test on a real AD page and a real PD page.
- **A new storage key:** add it to `storage-keys.ts` with a comment naming who writes it.
