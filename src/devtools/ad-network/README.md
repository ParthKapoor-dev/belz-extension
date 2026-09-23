# `src/devtools/ad-network/`

The **AD Network** DevTools panel. It lists the Automation Designer chain requests the inspected page
makes, with each method's name and category, which the built-in Network tab does not show. It runs
in the DevTools panel page, and reads method details from the inspected site's own REST API using
the page's session.

## Contents

| File / directory | What it does |
|---|---|
| [`panel.html`](panel.html) | Panel markup and styles: toolbar, request table, detail pane, toast. Ships as `panel.html` at the extension root and loads `dist/panel.js`. |
| [`panel.ts`](panel.ts) | Entry: constructs and starts an `AdNetworkPanel`. |
| [`network-panel.ts`](network-panel.ts) | `AdNetworkPanel`: captures requests, renders the table, row actions (copy as cURL, copy Slack link, open in draft), filter, preserve log, pending rows. |
| [`detail.ts`](detail.ts) | `DetailPane`: Headers, Payload, Response and Timing tabs for the selected row, and a Copy button. |
| [`names.ts`](names.ts) | `MethodNames` (names and categories learned so far) and `ResolveQueue` (debounced, batched lookups with retry). |
| [`api.ts`](api.ts) | `MethodResolver`: the chain-API client. Reuses the page's auth, tries V2 then V1, builds designer URLs. |
| [`cache.ts`](cache.ts) | `MethodCache`: stale-while-revalidate cache of method summaries in `chrome.storage.local`. |
| [`origin.ts`](origin.ts) | `InspectedSite`: the inspected origin, and the designer origin from the site's `designerHost` override. |
| [`pending-capture.ts`](pending-capture.ts) | `PendingCapture`: injects a fetch/XHR wrapper into the page and polls it for in-flight chain requests. |
| [`extract.ts`](extract.ts) | Pure: `classifyChainUrl()`, `extractMethodNameFromChainResponse()`, `firstString()`. |
| [`format.ts`](format.ts) | Pure: HAR reading and formatting (`statusGroup()`, `buildCurl()`, `harKey()`, `formatBytes()`, ...). |
| [`view.ts`](view.ts) | Small DOM builders: `iconButton()`, `flashOk()`, `flashText()`, `kvGrid()`. |
| [`json-tree.ts`](json-tree.ts) | `createJsonView()`: collapsible JSON viewer with filter, expand/collapse all and a Raw toggle. |
| [`types.ts`](types.ts) | `HarEntry`, `MethodSummary`, `ChainRequestInfo`, `PendingEntry`, `Row`. |

## How it works

1. `AdNetworkPanel.start()` loads three things in parallel into its `ready` promise: the inspected
   origin (`InspectedSite.detect()`), the site list (`loadSiteConfig()`) and the cache
   (`MethodCache.hydrate()`).
2. **Completed requests** come from `chrome.devtools.network`: `getHAR()` once, to backfill requests
   made before the panel opened, then `onRequestFinished` live. `onRequest()` keeps only chain URLs
   (`classifyChainUrl()`), drops duplicates by `harKey()`, and inserts rows in start-time order
   (at most 300 rows).
3. **In-flight requests** come from `PendingCapture`. It injects a wrapper into the page with
   `evalInPage()`; the wrapper records chain requests in `window.__belzADPending`, and the panel polls
   it every 500 ms to show pending rows. It is reinstalled on navigation.
4. **Names.** A definition fetch carries the name in its response body; the panel reads it with
   `getContent()` and records it (`MethodNames.learnName()`, `MethodResolver.rememberName()`). Every
   row's uuid also goes to `ResolveQueue`, which waits 250 ms, resolves up to 4 uuids at a time through
   `MethodResolver.resolveSummary()`, and retries a failed uuid every 4 s when `isRetryableError()`
   (`api.ts`) says it may clear on its own (unreachable host, 401/403, 408/429/5xx, or no HTTP
   status). Other HTTP errors, such as a 404 on both endpoints, are final. Failures show in the
   offline pill.
5. **`MethodResolver`** reads the cache first. On a miss it calls the V2 chain endpoint, then V1, on the
   inspected origin. For auth it uses, in order: the `Authorization` / `Expertly-Auth-Token` header
   seen on an observed chain request (`rememberAuth()`), a JWT found in page storage, or cookies alone.
6. **Row actions.** "Open" builds the designer URL (`buildDesignerUrl()`, on `InspectedSite.designerOrigin`;
   a published method opens its linked draft), adds the request body as `AUTOFILL_PARAM`, and opens it
   in a background tab. The `curl-autofill` feature in [`src/designer/`](../../designer/) fills the
   inputs from it.

The cache ages and the resolution order are documented in [AGENTS.md](../../../AGENTS.md)
("DevTools panel (AD chain inspector)").

## How it connects

- **Used by:** the browser loads `panel.html` when the user opens the tab created by `PanelRegistrar`
  in [`../panel-registrar.ts`](../panel-registrar.ts).
- **Depends on:** [`config/endpoints.ts`](../../config/endpoints.ts) (`CHAIN_PATH_RE`, chain and
  designer paths, `AUTOFILL_PARAM`), [`config/storage-keys.ts`](../../config/storage-keys.ts)
  (`AD_CACHE_STORAGE_KEY`), [`shared/hosts.ts`](../../shared/hosts.ts) (designer-host overrides),
  [`shared/focus-flag.ts`](../../shared/focus-flag.ts) (`Ctrl+Shift+A` scrolls to and pulses the
  newest row), [`shared/dom.ts`](../../shared/dom.ts), [`../inspected.ts`](../inspected.ts),
  [`../view.ts`](../view.ts), and the `chrome.devtools.network` and `chrome.devtools.inspectedWindow`
  APIs.

## Conventions

- `network-panel.ts` is the table and the wiring. Anything testable without the panel markup goes in
  its own module; pure helpers go in `extract.ts` or `format.ts`.
- Every class with listeners or timers follows the `start()` / `stop()` contract in
  [AGENTS.md](../../../AGENTS.md). Async work that can outlive `stop()` checks a generation or run id.
- The wrapper script in `pending-capture.ts` runs in the page, without extension APIs: it cannot import
  anything and does not log. Its chain regex is a deliberate inline copy of `CHAIN_PATH_RE`.
- Each HAR entry's response body may be missing; `DetailPane` handles inline text, `getContent()` with
  a timeout, and "not retained".

## Testing

Tests live in [`tests/devtools/`](../../../tests/devtools/): `ad-network-panel.test.ts` drives the real
panel over its real markup, and `api.test.ts`, `cache.test.ts`, `extract.test.ts`,
`format.test.ts` and `names.test.ts` cover those modules. To run the tests, see the root
[README](../../../README.md#development)'s Development section.

## Adding or changing things

- **A new row action:** add an `iconButton()` in `AdNetworkPanel.renderRow()` and a matching
  `<th>` only if you add a column (the pending row in `renderPendingRow()` must keep the same column
  count).
- **A new field from the chain API:** add it to `MethodSummary` in `types.ts`, read it in
  `summaryFromV2()` / `summaryFromV1()` in `api.ts`, and store it in `MethodCache.write()`.
- **The chain URL shape changed:** update `CHAIN_PATH_RE` in `config/endpoints.ts`, the inline copy in
  `pending-capture.ts`, and `classifyChainUrl()`.
