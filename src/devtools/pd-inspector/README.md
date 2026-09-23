# `src/devtools/pd-inspector/`

The **PD Inspector DevTools panel**: the UI half of the PD Inspector. It runs in the DevTools panel
page and only displays and sends commands. The engine that fetches page configs, builds the
component tree and highlights elements on the page is the other half, a content script in
[`src/pd-inspector-page/`](../../pd-inspector-page/) that runs inside the published page.

## Contents

| File / directory | What it does |
|---|---|
| [`panel.html`](panel.html) | Panel markup and styles: toolbar with `#inspect` and `#refresh`, and `#body`. Ships as `panel-pd.html` at the extension root and loads `dist/panel-pd.js`. |
| [`panel.ts`](panel.ts) | Entry: constructs and starts a `PdInspectorPanel`. |
| [`inspector-panel.ts`](inspector-panel.ts) | `PdInspectorPanel`: loads the engine's state, renders the page info, the component tree and a component's config nodes, and drives inspect mode. |

## How it works

1. `start()` calls `load()`, which sends `{ ns: 'pd', cmd: 'getState' }` to the engine. While the
   engine answers `status: 'loading'`, it asks again every 400 ms, up to 12 times. No answer means
   the page is not a published page (or was loaded before the extension), and the panel says so.
2. With `status: 'ready'`, `render()` shows the page info (path, env, app shell, PD page id,
   component count, anchor counts) and the component tree. Clicking a component shows its config
   node tree in the detail pane (`renderDetail()`) and sends `highlightComponent` so the engine
   outlines it on the page. "↗ PD" opens the page or component in Page Designer (`pdPagePath()`,
   `pdSymbolPath()` from [`config/endpoints.ts`](../../config/endpoints.ts)).
3. **Inspect** toggles `setInspect` on the engine. When the user clicks an element on the page, the
   engine pushes a `pick` message; `onPick()` shows the component chain and selects the innermost
   component in the tree.
4. On a `routeChanged` push, a navigation, a Refresh click or the `Ctrl+Shift+P` focus shortcut
   (`watchFocusFlag('pd', ...)`), the panel leaves inspect mode and reloads. Pushes from other tabs
   are ignored.

## How it connects

- **Talks to:** the engine in [`src/pd-inspector-page/`](../../pd-inspector-page/). Commands go
  through the background relay in [`src/background/index.ts`](../../background/index.ts) as
  `PdRelayMessage`s, because Firefox gives DevTools panels no `chrome.tabs`. Opening Page Designer
  also goes through the relay (`__pdRelay: 'open'`). The engine's pushes arrive directly on
  `chrome.runtime.onMessage`.
- **Depends on:** the message shapes and guards in [`shared/messages.ts`](../../shared/messages.ts),
  the data types in [`pd-inspector-page/types.ts`](../../pd-inspector-page/types.ts) and `KIND_BADGE`
  from [`pd-inspector-page/tree.ts`](../../pd-inspector-page/tree.ts) (imported as code, not shared
  state), `el()` and `FocusFlash` from [`../view.ts`](../view.ts), `required()` from
  [`shared/dom.ts`](../../shared/dom.ts), and [`shared/focus-flag.ts`](../../shared/focus-flag.ts).

## Conventions

- The panel never inspects the page itself. Anything that needs the page's DOM or its session is a
  command to the engine, added to `PdCommand` in [`shared/messages.ts`](../../shared/messages.ts).
- A load carries a generation number (`loadGeneration`), so an answer from an older load, or one
  arriving after `stop()`, is dropped.

## Testing

[`tests/devtools/pd-inspector-panel.test.ts`](../../../tests/devtools/pd-inspector-panel.test.ts)
drives `PdInspectorPanel` over the real `panel.html` with a fake engine behind the runtime
messaging. The data it renders is tested on the engine side, in
[`tests/pd-inspector-page/`](../../../tests/pd-inspector-page/). To run the tests, see the root
[README](../../../README.md#development)'s Development section.

## Adding or changing things

- **A new panel action that needs the page:** add a command to `PdCommand` in
  [`shared/messages.ts`](../../shared/messages.ts), handle it in `PdEngine.handleCommand()` in
  [`pd-inspector-page/engine.ts`](../../pd-inspector-page/engine.ts), and call it here with
  `callEngine()`.
- **Showing more page information:** add the field to `PageInfo` in
  [`pd-inspector-page/types.ts`](../../pd-inspector-page/types.ts), fill it in `PdEngine.build()`,
  and render it in `buildInfo()`.
