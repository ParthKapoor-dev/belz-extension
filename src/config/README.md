# `src/config/`

The single home for the extension's constants: the settings schema, the selectors and timings tuned
against the AD/PD pages, routes, endpoints, the extension's own file paths, storage keys and the naming
prefix. Every JavaScript world (content scripts, background, DevTools pages, options page) imports from
here. The modules hold no state, so each world can safely carry its own copy.

## Contents

| File / directory | What it does |
|---|---|
| [`settings.ts`](settings.ts) | `SETTINGS`: the one list of user settings (label, description, default, allowed values, modal section). `Settings`, `DEFAULT_SETTINGS`, `settingsIn()`, `sanitizeSetting()` and `sanitizeSettings()` are derived from it. |
| [`selectors.ts`](selectors.ts) | Every selector read from the designers' own markup, grouped by area: `HEADER`, `AD`, `PD`, `AD_INPUTS`, `AD_WIDGETS`, `AD_SCOPE`. Also `PD_CONFIG_NODES`, the node names in Page Designer's compiled configs. |
| [`timings.ts`](timings.ts) | `TIMINGS`: waits tuned against the designer pages (widget polls, pauses after clicks, `jsonButtonThrottle`, `rearmDelays`, `pdRoutePoll`), plus numbers two parts of the extension must agree on (`panelFocusFlash`, `pdInspectHeartbeat`, `pdInspectTimeout`) and the AD Network lookup retry schedule (`resolveRetry`). |
| [`routes.ts`](routes.ts) | Path prefixes: `AD_ROUTE_PREFIX` (`/automation-designer/`), `PD_ROUTE_PREFIX` (`/ui-designer/`), `PAGES_ROUTE_PREFIX` (`/pages/`). |
| [`endpoints.ts`](endpoints.ts) | Paths on the inspected host: `CHAIN_PATH_RE`, `PD_DEPLOYABLE_PATH`, `chainV2Path()`, `chainV1Path()`, `designerPath()`, `pdPagePath()`, `pdSymbolPath()`. |
| [`extension-files.ts`](extension-files.ts) | Paths of the extension's own files in the packaged tree: `CONTENT_SCRIPT_FILES`, `PANEL_PAGES`, `OPTIONS_PAGE`, `SITES_SEED_FILE`. |
| [`storage-keys.ts`](storage-keys.ts) | `chrome.storage` keys: `SETTINGS_STORAGE_KEY`, `HOSTS_STORAGE_KEY`, `AD_CACHE_STORAGE_KEY`, `FOCUS_STORAGE_KEY`, and the `AUTOFILL_HANDOFF_KEY_PREFIX` of an "Open in draft" handoff. |
| [`namespace.ts`](namespace.ts) | The one naming prefix, `belz`: `EXT_PREFIX`, `ns()`, `nsAttr()`, `nsGlobal()`, `EXTENSION_OWNED_ATTR`, `PAGE_GLOBALS` (the AD Network wrapper's one global in the inspected page), `COMMAND_MESSAGE_KEY`, `HOSTS_MESSAGE_KEY`, `AUTOFILL_MESSAGE_KEY`, `AUTOFILL_FRAGMENT_PARAM`. |

## The naming prefix

Every name the extension adds to a world it shares with someone else starts with `belz`, built in
[`namespace.ts`](namespace.ts):

- DOM ids and classes on the designer pages: `ns('SettingsButton')` → `belzSettingsButton`;
- data attributes: `nsAttr('owned')` → `data-belz-owned` (`EXTENSION_OWNED_ATTR` marks injected DOM);
- globals in the inspected page and message keys: `nsGlobal('Command')` → `__belzCommand`
  (`PAGE_GLOBALS`, `COMMAND_MESSAGE_KEY`, `HOSTS_MESSAGE_KEY`, `AUTOFILL_MESSAGE_KEY`);
- the autofill marker in a designer URL's fragment: `AUTOFILL_FRAGMENT_PARAM` (`belz-autofill`).

The storage keys are the exception: `SETTINGS_STORAGE_KEY`, `HOSTS_STORAGE_KEY`,
`AD_CACHE_STORAGE_KEY` and `FOCUS_STORAGE_KEY` keep their `sdExtension…V1` names, because renaming a
key would lose the settings and site list every user already has stored. New keys use `belz`.

## What belongs here

Put a value here when it is one of these:

- a **user setting** (add one entry to `SETTINGS`; nothing else needs a list of settings);
- a **selector or node name read from the AD/PD pages** (they break first when the designers change);
- a **wait tuned against the AD/PD pages' rendering**, or a timing two worlds must agree on;
- a **route, URL path or endpoint** on the inspected host;
- a **path of one of the extension's own files**;
- a **`chrome.storage` key**;
- a **name built with the prefix** that more than one module must agree on.

The rule: such values are not hard-coded anywhere else. Before inlining a string that looks like a
URL, path, storage key or DOM identifier, grep this folder for an existing entry, and add it here if
there is none. See the safe-change checklist in [AGENTS.md](../../AGENTS.md).

What does **not** belong here:

- The extension's own ids and classes. They are built with `ns()` next to the code that creates them.
- Timings of the extension's own UI (hover grace, the Esc Esc window, toast duration, the handoff TTL).
  They stay next to their code.
- Anything with state. These modules must stay plain constants and pure functions; the build's
  singleton check ([`scripts/check-singletons.mjs`](../../scripts/check-singletons.mjs)) scans this
  folder for top-level state.

## How it connects

- **Used by:** every world. The designer content scripts ([`designer/`](../designer/)) use settings,
  selectors, timings, routes and the namespace. [`pd-inspector-page/`](../pd-inspector-page/) uses
  `PD_CONFIG_NODES`, `PD_DEPLOYABLE_PATH`, `PAGES_ROUTE_PREFIX`, `TIMINGS.pdRoutePoll`,
  `TIMINGS.pdInspectTimeout` and `ns()`. [`devtools/`](../devtools/) uses the endpoints,
  `PANEL_PAGES`, `PAGE_GLOBALS`, `AUTOFILL_FRAGMENT_PARAM` and the panel timings.
  [`background/`](../background/), [`options/`](../options/) and [`shared/`](../shared/) use routes,
  extension files, storage keys and message keys.
- **Depends on:** nothing outside this folder. `endpoints.ts` imports `routes.ts`.

## Conventions

- A selector list means "try in order, first match wins" (`firstMatch()` in `designer/utils/dom.ts`).
- Storage keys carry a version suffix; see "Stored shapes" below.
- Group selectors by the page area that owns them, and say in a comment what the selector finds.

## Stored shapes

What is stored under a key is a contract with every installed copy: the settings (keyed by the
`SETTINGS` keys, with the values each accepts), the site list (`HostEntry`), the method cache.
Reading is forgiving: `sanitizeSettings()` gives a missing or invalid setting its default, and
`readHosts()` drops a malformed entry. Before the first release there are no installed copies to
keep, and these shapes change freely. From the first release on, an incompatible change (a renamed
setting key, a narrower set of values, a different structure) needs either a new key, with its
version suffix bumped, or a migration that reads the old shape and writes the new one.

## Testing

[`tests/config/settings.test.ts`](../../tests/config/settings.test.ts) covers the settings schema,
`sanitizeSetting` (a toggle takes only a real boolean) and `sanitizeSettings`. Selectors are exercised by the designer feature tests under
[`tests/designer/`](../../tests/designer/). To run the tests, see the root
[README](../../README.md#development)'s Development section.

## Adding or changing things

- **A new setting:** add one entry to `SETTINGS` with `toggle(...)` or `select({...})`. The type,
  default, validation and settings-modal row follow from it. Then read it where the feature starts.
- **A selector broke after a designer release:** fix it in `selectors.ts`, or add a fallback to its
  list, then smoke test on a real AD page and a real PD page.
- **A new storage key:** add it to `storage-keys.ts` with a comment naming who writes it, with the
  `belz` prefix.
