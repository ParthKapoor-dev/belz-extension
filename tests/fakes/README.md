# `tests/fakes/`

Test doubles for browser APIs. The unit tests run in Bun, where the `chrome.*` extension API does not exist, so this folder provides an in-memory one.

## Contents

| File | What it does |
|---|---|
| [`chrome.ts`](chrome.ts) | Exports `fakeChrome` (the shared instance), its type `FakeChrome`, `FakeEvent`, and two message senders: `extensionPageSender` and `contentScriptSender(url, tabId)`. |

## How it works

[`../setup.ts`](../setup.ts) sets `globalThis.chrome = fakeChrome` before any test file loads, so source modules that use `chrome` at import time get the fake. Tests import `fakeChrome` from here to seed state and read what the code did.

What it implements:

| Area | Behaviour |
|---|---|
| `FakeEvent` | `addListener`, `removeListener`, `hasListener`, and `dispatch(...args)` to fire it from a test (returns the listeners' results). Its `listeners` array is public, so tests can count listeners. |
| `storage.local`, `storage.session` | Map-backed. `get` works with a callback (called on a microtask) or as a promise, and returns clones. `set` and `remove` fire the shared `storage.onChanged` **a task later** (a `setTimeout` of 0), as the browser does, with `oldValue`/`newValue` and the area name, and only for keys whose value actually changed. |
| `runtime` | `id` (`test-extension`), `getURL()`, `lastError`, and `onMessage` / `onInstalled` / `onStartup` events. `sendMessage` records each message in `runtime.sent` and answers with `runtime.respond(message)` (set it per test; undefined by default). A promise returned by `respond` is waited for; the answer goes to the callback and to the returned promise. |
| `scripting` | `registerContentScripts` answers asynchronously and is all-or-nothing: a duplicate id (already registered, or twice in the call) rejects the whole call with "Duplicate script ID", so overlapping registrations fail as in the browser. Also `updateContentScripts`, `unregisterContentScripts`, `getRegisteredContentScripts`. Registrations are in `scripting.registered`. |
| `permissions` | `contains`, `request`, `remove`, and `onAdded` / `onRemoved`. Granted origins are in `permissions.granted`; every `request` is recorded in `permissions.requested`. `request` grants unless `permissions.allowRequest` is `false`; `remove` succeeds unless `permissions.allowRemove` is `false`. |
| `tabs` | `create` records into `tabs.created`. `sendMessage` records `[tabId, message]` in `tabs.messages` and answers with `tabs.respond(tabId, message)` on a microtask. `query` answers with `tabs.queryResult`. |
| `commands` | `onCommand` event. |
| `devtools` | `inspectedWindow.eval` records each expression in `inspectedWindow.evaluated` and returns whatever `inspectedWindow.evalHandler(expression)` returns (set it per test); `network.onNavigated` / `onRequestFinished` events; `getHAR` returns no entries; `panels.create` records `[title, page]` in `panels.created` and calls back at once. |

`extensionPageSender` is a sender as one of the extension's own pages would have it (this extension's id, an extension URL, no tab). `contentScriptSender(url, tabId)` is the extension's content script in a tab at `url`.

`fakeChrome.reset()` clears stored data, registrations, grants and recorded requests, recorded messages, tabs, panels and evaluated expressions, `lastError`, and resets `evalHandler`, `runtime.respond`, `tabs.respond`, `tabs.queryResult`, `allowRequest` and `allowRemove`. It keeps registered listeners, because source modules may have added them at import time.

## Conventions

- Call `fakeChrome.reset()` in a `beforeEach` in any file whose tests depend on storage or registrations. Every test file shares the one instance.
- `storage.onChanged` is asynchronous: after a write, wait a task (`nextTask()` from [`../wait.ts`](../wait.ts)) or wait on the result with `waitFor()` before asserting what a listener did.
- A test that replaces a method on the fake (to hold a call open, or make it fail) puts the original back in `finally`.
- Only implement what the source uses. When code starts using a new `chrome.*` call, add it here, matching the real API's behaviour where the code depends on it.
