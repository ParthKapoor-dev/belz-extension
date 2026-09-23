# `src/devtools/`

Everything that runs inside the browser's DevTools: the DevTools page, which adds the extension's
panels, and the two panels themselves, **AD Network** and **PD Inspector**. Each panel is its own
page with its own bundle. For how this folder fits with the rest of `src/`, see
[`src/README.md`](../README.md).

## Contents

| File / directory | What it does |
|---|---|
| [`devtools.html`](devtools.html) | The DevTools page shell. Loads `dist/devtools-page.js`. |
| [`devtools-page.ts`](devtools-page.ts) | Entry: constructs and starts a `PanelRegistrar`. |
| [`panel-registrar.ts`](panel-registrar.ts) | `PanelRegistrar`: creates the two panels, but only when DevTools inspects an allowed site. |
| [`inspected.ts`](inspected.ts) | `evalInPage()`: runs an expression in the inspected page, resolving null on any failure. |
| [`view.ts`](view.ts) | Helpers shared by both panels: `el()` builds an element, `FocusFlash` pulses an element for `TIMINGS.panelFocusFlash`. |
| [`ad-network/`](ad-network/) | The "AD Network" panel: Automation Designer chain requests with method names (its own README has details). |
| [`pd-inspector/`](pd-inspector/) | The "PD Inspector" panel: the UI half of the PD Inspector. The page half is [`src/pd-inspector-page/`](../pd-inspector-page/) (each has its own README). |

## How it works

1. The browser loads the DevTools page (`devtools_page` in `manifest.json`) once per open DevTools
   window, on every site.
2. `PanelRegistrar.start()` reads the inspected origin with `evalInPage('location.origin')` and the
   granted hosts with `enabledHostSet()`, and asks `isAllowedUrl()` (https, and a granted host,
   normalised like the stored list: lowercase, any port). If the page is allowed, it calls
   `chrome.devtools.panels.create` for "AD Network" and "PD Inspector", with the pages named in
   `PANEL_PAGES` ([`config/extension-files.ts`](../config/extension-files.ts): `panel.html`,
   `panel-pd.html`). It tries again on `devtools.network.onNavigated` and whenever the host list
   changes, so the panels appear as soon as the user reaches an allowed site. DevTools cannot remove
   a panel, so `stop()` only stops watching.
3. The browser loads a panel's page the first time the user opens its tab. Each panel entry
   (`panel.ts`) only constructs and starts its class.
4. DevTools stays open when the inspected tab navigates to another site. The panels therefore check
   again on every navigation: the AD Network panel looks nothing up and patches nothing unless the
   inspected page is on an allowed site (see [`ad-network/`](ad-network/)).

## How it connects

- **Used by:** the browser, through `devtools_page` in `manifest.json`.
- **Depends on:** [`shared/hosts.ts`](../shared/hosts.ts) (panel gating),
  [`shared/logger.ts`](../shared/logger.ts), [`config/timings.ts`](../config/timings.ts)
  (`panelFocusFlash`), [`config/extension-files.ts`](../config/extension-files.ts) (`PANEL_PAGES`),
  and the `chrome.devtools.*` APIs.

## Conventions

- **HTML pages sit next to their script but ship at the extension root.**
  [`scripts/pack.mjs`](../../scripts/pack.mjs) copies `devtools.html`, `ad-network/panel.html` and
  `pd-inspector/panel.html` to `devtools.html`, `panel.html` and `panel-pd.html` at the root.
  Chromium resolves a panel page path against the extension root and Firefox against the DevTools
  page; they agree only when all of them sit together at the root. That is why the pages load their
  script as `dist/<name>.js`.
- Each HTML page is a separate bundle, listed in the `standalone` list of
  [`scripts/build.mjs`](../../scripts/build.mjs). Panels share code by import, never by state.
- Panel classes follow the lifecycle contract in [AGENTS.md](../../AGENTS.md): `start()` / `stop()`,
  safe to call twice, `stop()` removes every listener and timer.
- Code shared by both panels goes in `view.ts` or `inspected.ts`, not in either panel's folder.

## Testing

Panel tests live in [`tests/devtools/`](../../tests/devtools/) (the AD Network panel and its
modules, the PD Inspector panel, and `PanelRegistrar`). To run the tests, see the root
[README](../../README.md#development)'s Development section.

## Adding or changing things

- **A third panel:** add a folder with `panel.html`, `panel.ts` and its class; add its page to
  `PANEL_PAGES` in `config/extension-files.ts` and to `PANELS` in `panel-registrar.ts`; add the bundle to `standalone` in `scripts/build.mjs` and the HTML page to
  `SHARED` in `scripts/pack.mjs`. Follow the entry-point checklist in [AGENTS.md](../../AGENTS.md).
