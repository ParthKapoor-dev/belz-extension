# `tests/devtools/`

Unit tests for [`src/devtools/`](../../src/devtools/): the "AD Network" panel in [`ad-network/`](../../src/devtools/ad-network/), the "PD Inspector" panel in [`pd-inspector/`](../../src/devtools/pd-inspector/), and the DevTools page's `PanelRegistrar`. They use the `chrome.devtools` part of the fake in [`../fakes/`](../fakes/) and stub `globalThis.fetch` for the platform's chain API.

## Contents

| File | Source under test | What it covers |
|---|---|---|
| [`ad-network-panel.test.ts`](ad-network-panel.test.ts) | [`network-panel.ts`](../../src/devtools/ad-network/network-panel.ts) | The real `AdNetworkPanel` over the real `panel.html` markup: chain requests become rows, others are ignored; duplicates (same instant, different time format) are one row; rows sort by start time; names and categories resolve from the platform; the filter; the detail pane and its tabs; pause and Clear; `start()` is idempotent and `stop()` removes every listener it added. |
| [`api.test.ts`](api.test.ts) | [`api.ts`](../../src/devtools/ad-network/api.ts) | `MethodResolver.resolveSummary()`: v2 endpoint and URL, fallback to v1, a 401 reported as "not signed in" without a v1 try, cache hits, one request for concurrent resolves of a uuid, auth headers replayed from `rememberAuth()` (not `Cookie`). `buildDesignerUrl()` for drafts, published methods (via `referenceId`) and no summary. |
| [`names.test.ts`](names.test.ts) | [`names.ts`](../../src/devtools/ad-network/names.ts), [`api.ts`](../../src/devtools/ad-network/api.ts) | `isRetryableError()` per failure kind. `ResolveQueue` with a stub resolver: a resolved uuid's name and category are learned; a retryable failure is queued for a retry; a definite HTTP error (404) and a null summary are final; `stop()` drops queued uuids. |
| [`panel-registrar.test.ts`](panel-registrar.test.ts) | [`panel-registrar.ts`](../../src/devtools/panel-registrar.ts) | Both panels are created on a granted site (case-insensitive, and on a non-default port, since it reads `location.hostname`), never on an unlisted, ungranted or unknown host; after navigating to an allowed site or adding the host, once; a failed registration is retried; `start()` is idempotent and `stop()` removes its listeners. |
| [`pd-inspector-panel.test.ts`](pd-inspector-panel.test.ts) | [`inspector-panel.ts`](../../src/devtools/pd-inspector/inspector-panel.ts) | The real `PdInspectorPanel` over the real `pd-inspector/panel.html`, with a fake engine answering through `fakeChrome.runtime.respond`: page info and component tree; selecting a component shows its layout and asks the engine to highlight it; Inspect toggles; picks from other tabs are ignored; the no-engine notice and engine errors; a route change reloads; the focus shortcut pulses for `TIMINGS.panelFocusFlash` (the `--focus-flash-ms` property); `start()` is idempotent and `stop()` removes every listener and the pulse. |
| [`cache.test.ts`](cache.test.ts) | [`cache.ts`](../../src/devtools/ad-network/cache.ts) | `MethodCache` ages: fresh under 6 hours, stale but served until 14 days, gone after; keys are per origin; an empty summary is not stored. Time is set with `setSystemTime()`. |
| [`extract.test.ts`](extract.test.ts) | [`extract.ts`](../../src/devtools/ad-network/extract.ts) | `classifyChainUrl()` for v1/v2 fetches, execute and test-execute, lower-casing, ignoring query strings and non-chain URLs. `extractMethodNameFromChainResponse()` for the v2 and v1 shapes and bodies with no name. |
| [`format.test.ts`](format.test.ts) | [`format.ts`](../../src/devtools/ad-network/format.ts) | `statusGroup()`, `formatBytes()`, `startedAt()` and `harKey()` across time-zone offsets, `buildCurl()` quoting and pseudo-header skipping, `prettyMaybeJson()`, `shortUuidFromUrl()`. |

## How it works

`ad-network-panel.test.ts` loads [`panel.html`](../../src/devtools/ad-network/panel.html), keeps its `<body>` without `<script>` tags, and puts it in the document. It sets `fakeChrome.devtools.inspectedWindow.evalHandler` so `location.origin` returns `https://nsm.test`, and stubs `fetch` so every method resolves as "Resolved" in "Cat". It then feeds HAR entries through `fakeChrome.devtools.network.onRequestFinished.dispatch()`, as the browser would. `afterAll` calls `panel.stop()` and restores `fetch`.

`api.test.ts` shares one `InspectedSite`, `MethodCache` and `MethodResolver` across tests, so each test uses a fresh uuid from `nextUuid()` to avoid cache hits from earlier tests.

## Conventions

- Panel assertions read text, class names and counts only, never elements (see [`../README.md`](../README.md)).
- Tests that start a class (`AdNetworkPanel`, `PdInspectorPanel`, `PanelRegistrar`, `ResolveQueue`) stop it in `afterAll`/`afterEach`, so no listener or timer outlives the file.
