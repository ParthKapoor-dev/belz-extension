# `src/devtools/ad-network/`

The **AD Network** DevTools panel. It lists the Automation Designer chain requests the inspected page
makes, with each method's name and category, which the built-in Network tab does not show. It runs
in the DevTools panel page, and reads method details from the inspected site's own REST API using
the page's session, only while the inspected page is on an allowed site.

## Contents

| File / directory | What it does |
|---|---|
| [`panel.html`](panel.html) | Panel markup and styles: toolbar, request table, detail pane, toast. Ships as `panel.html` at the extension root and loads `dist/panel.js`. |
| [`panel.ts`](panel.ts) | Entry: constructs and starts an `AdNetworkPanel`. |
| [`network-panel.ts`](network-panel.ts) | `AdNetworkPanel`: captures requests, renders the table, row actions (copy as cURL, copy Slack link, open in draft), filter, preserve log, pending rows, and what the panel may do on the inspected site. Also `withAutofill()`. |
| [`detail.ts`](detail.ts) | `DetailPane`: Headers, Payload, Response and Timing tabs for the selected row, and a Copy button. |
| [`names.ts`](names.ts) | `MethodNames` (names and categories learned so far) and `ResolveQueue` (debounced, batched lookups with backed-off, capped retries; `RetryPolicy`). |
| [`api.ts`](api.ts) | `MethodResolver`: the chain-API client. Per-origin auth, V2 then V1, designer URLs. Also `ApiError` and `isRetryableError()`. |
| [`cache.ts`](cache.ts) | `MethodCache`: stale-while-revalidate cache of method summaries in `chrome.storage.local`, merged with the stored map on every flush. |
| [`origin.ts`](origin.ts) | `InspectedSite`: the inspected origin, whether it is an allowed site (`isAllowed`, `isAllowedOrigin()`), and the designer origin from the site's `designerHost` override. |
| [`pending-capture.ts`](pending-capture.ts) | `PendingCapture` and the page scripts `WRAPPER_SCRIPT` / `UNINSTALL_SCRIPT`: a fetch/XHR wrapper in the page, polled for in-flight chain requests. |
| [`extract.ts`](extract.ts) | Pure: `classifyChainUrl()`, `extractMethodNameFromChainResponse()`, `definitionOf()`, `nameFromDefinition()`, `asObject()`, `firstString()`. |
| [`format.ts`](format.ts) | Pure: HAR reading and formatting (`statusGroup()`, `buildCurl()`, `harKey()`, `formatBytes()`, `lookupFailure()`, ...). |
| [`view.ts`](view.ts) | Small DOM builders: `iconButton()`, `flashOk()`, `flashText()`, `kvGrid()`. |
| [`json-tree.ts`](json-tree.ts) | `createJsonView()`: collapsible JSON viewer with filter, expand/collapse all and a Raw toggle. |
| [`types.ts`](types.ts) | `HarEntry`, `MethodSummary`, `ChainRequestInfo`, `PendingEntry`, `Row`. |

## How it works

1. `AdNetworkPanel.start()` loads three things in parallel into its `ready` promise: the inspected
   origin (`InspectedSite.detect()`), the site list (`loadSiteConfig()`) and the cache
   (`MethodCache.hydrate()`). Then `applySiteAccess()` decides what the panel may do (step 3).
2. **Completed requests** come from `chrome.devtools.network`: `getHAR()` once, to backfill requests
   made before the panel opened, then `onRequestFinished` live. `onRequest()` keeps only chain URLs
   (`classifyChainUrl()`), drops duplicates by `harKey()`, and inserts rows in start-time order
   (at most 300 rows). Rows are listed on any site.
3. **Allowed sites only.** DevTools stays open when the tab navigates elsewhere, so on every navigation
   (`onNavigated`) the panel first calls `MethodResolver.forgetAuth()`, then re-detects the origin and
   runs `applySiteAccess()`. On an allowed site (`InspectedSite.isAllowed`: https, and a granted host of
   the list) it starts `PendingCapture` and queues name lookups. Anywhere else it stops
   `PendingCapture` (putting the page's fetch/XHR back), stops the queue, forgets auth, looks nothing up,
   and says "not on an allowed site" in the offline pill. The site list is watched, so granting or
   revoking a site takes effect at once.
4. **In-flight requests** come from `PendingCapture`. `start()` injects `WRAPPER_SCRIPT` with
   `evalInPage()`; the wrapper records chain requests in the page global `PAGE_GLOBALS.pending`
   ([`config/namespace.ts`](../../config/namespace.ts)), and the panel polls it every 500 ms to show
   pending rows. `install()` wraps again after a navigation. `stop()` runs `UNINSTALL_SCRIPT`, which
   puts back every original the page has not replaced since and switches the wrapper off either way
   (it then passes every call through). The wrapper also retires itself the same way when the panel
   has not polled it for `STALE_MS`, as happens when DevTools closes without a `stop()`.
5. **Names.** A definition fetch carries the name in its response body; on an allowed site the panel
   reads it with `getContent()` and records it (`MethodNames.learnName()`,
   `MethodResolver.rememberName()`). Every row's uuid also goes to `ResolveQueue`, which waits 250 ms
   and resolves up to 4 uuids at a time through `MethodResolver.resolveSummary()`. A uuid that fails
   with an error `isRetryableError()` says may clear on its own (unreachable host, 401/403,
   408/429/5xx, or no HTTP status) is retried on the schedule in `TIMINGS.resolveRetry`: the wait
   doubles after each failing round up to a maximum, and the uuid is given up after a fixed number of
   failed lookups. Other HTTP errors (a 404 on both endpoints) and `final` errors (not an allowed site)
   are not retried. Failures show in the offline pill.
6. **`MethodResolver`** refuses outright when the inspected page is not allowed. Otherwise it reads the
   cache first; on a miss it calls the V2 chain endpoint, then V1, on the inspected origin. Auth is
   always for the origin it came from, in this order:
   - the `Authorization` / `Expertly-Auth-Token` header seen on an observed chain request to that
     origin (`rememberAuth()`, kept per origin and only for allowed origins);
   - the page's sign-in token, read by a scan in the page: `localStorage.authToken` first, else the
     first JWT in local or session storage. The scan reports the origin it ran on, and the token is
     only used for that origin. A scan that found nothing is not remembered;
   - cookies alone (`credentials: 'include'`).

   A 401/403 with a remembered header or token drops it and tries once more with fresh auth.
7. **Row actions.** "Copy Slack link" puts a `category::method` link on the clipboard with
   `copyRichLink()` ([`shared/rich-link.ts`](../../shared/rich-link.ts)), label escaped. "Open" builds
   the designer URL (`buildDesignerUrl()`, on `InspectedSite.designerOrigin`; a published method opens
   its linked draft) and opens it in a background tab, one queued request at a time. When the request
   had a body, `withAutofill()` leaves it in extension storage with `storeHandoff()`
   ([`shared/autofill-handoff.ts`](../../shared/autofill-handoff.ts)) and puts only the one-time id in
   the URL's fragment (`#belz-autofill=<id>`). The `curl-autofill` feature in
   [`src/designer/`](../../designer/) takes the body from the background and fills the inputs.
8. **Cache.** `MethodCache` keeps entries fresh for 6 h, serves them stale (revalidating) up to 14 days,
   and keeps at most 800. Several DevTools windows share the stored map, so a flush writes only the
   entries this panel changed, merged into what is stored at that moment (the newer entry wins per key), and
   learns the other windows' entries. `flush()` writes at once; writes are otherwise debounced.

The resolution order is also described in [AGENTS.md](../../../AGENTS.md)
("DevTools panel (AD chain inspector)").

## How it connects

- **Used by:** the browser loads `panel.html` when the user opens the tab created by `PanelRegistrar`
  in [`../panel-registrar.ts`](../panel-registrar.ts).
- **Depends on:** [`config/endpoints.ts`](../../config/endpoints.ts) (`CHAIN_PATH_RE`, chain and
  designer paths), [`config/namespace.ts`](../../config/namespace.ts) (`PAGE_GLOBALS`,
  `AUTOFILL_FRAGMENT_PARAM`), [`config/storage-keys.ts`](../../config/storage-keys.ts)
  (`AD_CACHE_STORAGE_KEY`), [`config/timings.ts`](../../config/timings.ts) (`resolveRetry`),
  [`shared/hosts.ts`](../../shared/hosts.ts) (allowed sites, designer-host overrides),
  [`shared/autofill-handoff.ts`](../../shared/autofill-handoff.ts),
  [`shared/rich-link.ts`](../../shared/rich-link.ts), [`shared/errors.ts`](../../shared/errors.ts),
  [`shared/focus-flag.ts`](../../shared/focus-flag.ts) (`Ctrl+Shift+A` scrolls to and pulses the
  newest row), [`shared/dom.ts`](../../shared/dom.ts), [`../inspected.ts`](../inspected.ts),
  [`../view.ts`](../view.ts), and the `chrome.devtools.network`, `chrome.devtools.inspectedWindow`,
  `chrome.storage` and `chrome.tabs` APIs.

## Conventions

- Nothing that touches the network or the page (lookups, header harvesting, the token scan, the
  fetch wrapper) runs unless `InspectedSite` says the page is on an allowed site.
- `network-panel.ts` is the table and the wiring. Anything testable without the panel markup goes in
  its own module; pure helpers go in `extract.ts` or `format.ts`.
- Every class with listeners or timers follows the `start()` / `stop()` contract in
  [AGENTS.md](../../../AGENTS.md). Async work that can outlive `stop()` checks a generation or run id.
  `AdNetworkPanel` also stops itself on `pagehide`, so closing DevTools puts the page's fetch/XHR back.
- The scripts in `pending-capture.ts` run in the page, without extension APIs: they cannot import
  anything and do not log. Their chain regex is a deliberate inline copy of `CHAIN_PATH_RE`.
- Each HAR entry's response body may be missing; `DetailPane` handles inline text, `getContent()` with
  a timeout, and "not retained".

## Testing

Tests live in [`tests/devtools/`](../../../tests/devtools/): `ad-network-panel.test.ts` drives the real
panel over its real markup (including allowed-site gating, navigation and the "Open in draft"
handoff); `api.test.ts` covers per-origin auth, the token scan and the 401 rescan;
`pending-capture.test.ts` runs the page scripts against the test page's window; `cache.test.ts`,
`extract.test.ts`, `format.test.ts` and `names.test.ts` cover those modules. To run the tests, see the
root [README](../../../README.md#development)'s Development section.

## Adding or changing things

- **A new row action:** add an `iconButton()` in `AdNetworkPanel.renderRow()` and a matching
  `<th>` only if you add a column (the pending row in `renderPendingRow()` must keep the same column
  count).
- **A new field from the chain API:** add it to `MethodSummary` in `types.ts`, read it in
  `summaryFromV2()` / `summaryFromV1()` in `api.ts`, and store it in `MethodCache.write()`.
- **The chain URL shape changed:** update `CHAIN_PATH_RE` in `config/endpoints.ts`, the inline copy in
  `pending-capture.ts`, and `classifyChainUrl()`.
