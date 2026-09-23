# `tests/pd-inspector-page/`

Unit tests for the PD Inspector engine in [`src/pd-inspector-page/`](../../src/pd-inspector-page/), the content script that runs on published `/pages/*`. They cover the config fetching, the trees built from configs, and the resolver that maps DOM elements to config nodes.

## Contents

| File | Source under test | What it covers |
|---|---|---|
| [`config-fetch.test.ts`](config-fetch.test.ts) | [`config.ts`](../../src/pd-inspector-page/config.ts) | `fetchJson()`: a network error or 408/429/5xx is retried, three tries in all; a 401/403/404 fails at once. `fetchPageConfig()`: a static page at its literal path; a URL with a record id resolved through the route table, where the most specific template wins; an error when nothing is deployed. `fetchShellConfig()`: the first path segment is a shell only if its layout has a `router-outlet`; a single-segment page is never its own shell (no request made). `fetchComponentGraph()`: embedded components fetched transitively, each once, with missing ones stubbed with an error. |
| [`model.test.ts`](model.test.ts) | [`tree.ts`](../../src/pd-inspector-page/tree.ts), [`config.ts`](../../src/pd-inspector-page/config.ts), [`component-tree.ts`](../../src/pd-inspector-page/component-tree.ts) | `buildTree()` node kinds, labels and synthetic ids; `getVisibility()` verdicts; `summarize()` counts. `isSymbolRef()` (a component reference is a childless `isSymbol` node) and `collectChildRefs()`. `buildComponentTree()`: nesting, errors for failed or unfetched components, a shell wrapping the page at its outlet, and a self-embedding component that does not recurse forever. `componentNames()`. |
| [`engine.test.ts`](engine.test.ts) | [`engine.ts`](../../src/pd-inspector-page/engine.ts), [`highlight.ts`](../../src/pd-inspector-page/highlight.ts) | Lifecycle. `Highlighter`: touches nothing before `start()` and `show()`; `start()` twice listens once; `stop()` unmounts and unlistens. `PdEngine`: does nothing off a published page; `start()` twice wires once; `stop()` removes the message listener, inspect-mode and scroll listeners and the route poll; a failed build reports an error; a build overtaken by a route change, or by `stop()`, never overwrites the newer state. Inspect mode: a click is a pick pushed to the panel and never reaches the page, and stops being swallowed once inspect mode is off; without the panel's heartbeat the watchdog ends inspect mode by itself; each heartbeat (`setInspect` on again) keeps it on; commands from another extension, or malformed ones, are ignored. |
| [`resolve.test.ts`](resolve.test.ts) | [`resolve.ts`](../../src/pd-inspector-page/resolve.ts) | `buildConfigIndex()` owner chains across shell, component and page. `Resolver`: one node and one element is exact; equal counts pair in document order; mismatched counts are refused; an invalid class token does not break the rest; `elementsForComponent()`; `getStats()`. |

## How it works

- `config-fetch.test.ts` replaces `fetch` with `serveDeployables()`, a fake deployable endpoint. It answers by the `pageType` and `path` query parameters, returns the route table when `deployableInfo` is set, and records every request so a test can assert what was (or was not) fetched.
- `model.test.ts` builds configs from small `layout()` and `symbol()` helpers; no DOM and no network.
- `engine.test.ts` moves the page with `history.replaceState` (to `/pages/...` and away), stubs `fetch` to fail (a gate holds it for the generation tests), counts window and document listeners by wrapping `addEventListener`, and asks for state and sends commands the way the relay does, through `fakeChrome.runtime.onMessage` with this extension's id as the sender. The inspect-mode tests build the engine with a short watchdog (`new PdEngine(150)`) and give it a stub resolver, so every click resolves to one component.
- `resolve.test.ts` renders markup into `document.body` and builds a `Resolver` over a matching config.

## Conventions

- Resolver results hold DOM elements. `resolve.test.ts` reduces each hit to `{ owner, node, exact }` before asserting (see [`../README.md`](../README.md)).
- Every engine a test starts is stopped in the same test or in `afterEach`.
