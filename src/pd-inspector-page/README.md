# `src/pd-inspector-page/`

The **PD Inspector engine**: a content script that runs inside published Page Designer pages
(`/pages/*`). It fetches the page's compiled configs, builds the component tree, maps page elements
to the config nodes that produced them, and draws the on-page highlight. It has no UI of its own:
the UI is the DevTools panel in [`src/devtools/pd-inspector/`](../devtools/pd-inspector/), which
sends it commands.

## Contents

| File / directory | What it does |
|---|---|
| [`index.ts`](index.ts) | Entry, built to `dist/pd-inspector.js`: constructs and starts a `PdEngine`. |
| [`engine.ts`](engine.ts) | `PdEngine`: builds the page model, answers the panel's commands, runs inspect mode, follows route changes. |
| [`config.ts`](config.ts) | Fetches the page, app-shell and component configs from the deployable endpoint (`fetchPageConfig()`, `fetchShellConfig()`, `fetchComponentGraph()`). |
| [`component-tree.ts`](component-tree.ts) | `buildComponentTree()`: which components the page embeds and how they nest, from configs only. |
| [`tree.ts`](tree.ts) | `buildTree()`: a raw config `layout` as a normalised node tree with kind, label and visibility; `summarize()`, `KIND_BADGE`. |
| [`resolve.ts`](resolve.ts) | `buildConfigIndex()` and `Resolver`: which config node owns a DOM element, anchored on `className`. |
| [`highlight.ts`](highlight.ts) | `Highlighter`: the outline boxes and label drawn over the page, in a shadow root. |
| [`types.ts`](types.ts) | Config, tree and engine data shapes, shared with the panel. |

## How it works

1. `PdEngine.start()` reads the page context (`getPageContext()`); it does nothing on a URL that is
   not under `/pages/`.
2. `build()` fetches the page config (`fetchPageConfig()`; if the literal path has no deployed page,
   it matches the path against the domain's route table). It then looks for an **app shell**, a
   separate page found by the first path segment whose layout contains a `router-outlet` node
   (`fetchShellConfig()`), and fetches every embedded component recursively into one shared graph
   (`fetchComponentGraph()`). A component that fails to fetch becomes a stub with an `error`.
3. `buildComponentTree()` assembles the nesting from configs alone, splicing the page in at the
   shell's outlet. A component reference is a childless `isSymbol` node. This half is exact.
4. `buildConfigIndex()` flattens the whole composed config and groups nodes by `props.className`.
   `Resolver.rebuild()` pins elements to those nodes: one node and one element is an exact anchor;
   several of each are paired in document order only when the counts agree, and refused otherwise.
   `Resolver.resolve()` climbs from an element to its nearest anchored ancestor.
5. The engine stores the result as `EngineState` and answers the panel's `PdCommand`s: `getState`,
   `setInspect`, `highlightComponent`, `clearHighlight`. It answers only this extension
   (`isFromExtension()`, the background relay) and only a command that passes the full-shape
   `isPdCommand()` guard.
6. In inspect mode, pointer moves outline the owning node with the `Highlighter`, and a click pushes
   a `pick` message to the panel and never reaches the page. Inspect mode swallows the page's clicks,
   so it has a watchdog: each `setInspect` with `on: true` (the panel re-sends it as a heartbeat)
   re-arms a timer, and when `TIMINGS.pdInspectTimeout` passes without one (DevTools was closed, the
   panel reloaded) the engine leaves inspect mode by itself. The constructor's `inspectTimeout`
   parameter overrides the timeout, for tests.
7. Every `TIMINGS.pdRoutePoll` the engine checks the path; on a change
   it leaves inspect mode, rebuilds (a generation counter drops the older build) and pushes
   `routeChanged`.

[AGENTS.md](../../AGENTS.md) ("PD Inspector") explains why the tree is exact and inspect mode is
anchored rather than guessed.

## How it connects

- **Used by:** the browser. [`background/content-scripts.ts`](../background/content-scripts.ts)
  registers `dist/pd-inspector.js` on `/pages/*` of each allowed host (id `pdi-<host>`).
- **Talks to:** the [PD Inspector panel](../devtools/pd-inspector/). Commands arrive through the
  background relay as `chrome.tabs` messages; pushes (`PdPushMessage`) go out with
  `chrome.runtime.sendMessage`. All messages carry `ns: 'pd'`. Shapes are in
  [`shared/messages.ts`](../shared/messages.ts).
- **Depends on:** `PD_DEPLOYABLE_PATH` ([`config/endpoints.ts`](../config/endpoints.ts)),
  `PAGES_ROUTE_PREFIX` ([`config/routes.ts`](../config/routes.ts)), `PD_CONFIG_NODES`
  ([`config/selectors.ts`](../config/selectors.ts)), `TIMINGS.pdRoutePoll` and
  `TIMINGS.pdInspectTimeout`, `ns()` and `EXTENSION_OWNED_ATTR` ([`config/namespace.ts`](../config/namespace.ts)), the page's own session
  (fetches use `credentials: 'include'`), and the live DOM.

## Conventions

- This is a separate JavaScript world from the designer content scripts: a standalone bundle, not
  part of the code-split designer graph, and excluded from the singleton check.
- Page Designer's config vocabulary (outlet, form-field, button and data-table node names) lives in
  `PD_CONFIG_NODES`, not here.
- Anything sent to the panel must be structured-clone friendly: `serializeComponentTree()` strips the
  raw configs first.
- The panel imports `types.ts` and `KIND_BADGE` from here. Keep both free of page side effects.

## Testing

Tests live in [`tests/pd-inspector-page/`](../../tests/pd-inspector-page/): `config-fetch.test.ts`
(page, shell and component fetches), `model.test.ts` (config tree, references, component tree) and
`resolve.test.ts` (`buildConfigIndex` and `Resolver`) and `engine.test.ts` (the `PdEngine` and
`Highlighter` lifecycle, the build generation guard, inspect-mode clicks, the watchdog, and the
sender and command checks). To run the tests, see the root
[README](../../README.md#development)'s Development section.

## Adding or changing things

- **A new panel command:** add it to `PdCommand` and the `isPdCommand()` guard in
  [`shared/messages.ts`](../shared/messages.ts), handle it in `PdEngine.handleCommand()`, and call it from `PdInspectorPanel`.
- **A new node kind in the tree:** add it to `NodeKind` in `types.ts`, to `KIND` and `KIND_BADGE`
  and `detectKind()` in `tree.ts`, and any names it matches to `PD_CONFIG_NODES`. Add a
  `.nbadge.k-<KIND>` style in the panel's `panel.html` if it needs a colour.
