# `tests/fakes/`

Test doubles for browser APIs. The unit tests run in Bun, where the `chrome.*` extension API does not exist, so this folder provides an in-memory one.

## Contents

| File | What it does |
|---|---|
| [`chrome.ts`](chrome.ts) | Exports `fakeChrome` (the shared instance), its type `FakeChrome`, and `FakeEvent`. |

## How it works

[`../setup.ts`](../setup.ts) sets `globalThis.chrome = fakeChrome` before any test file loads, so source modules that use `chrome` at import time get the fake. Tests import `fakeChrome` from here to seed state and read what the code did.

What it implements:

| Area | Behaviour |
|---|---|
| `FakeEvent` | `addListener`, `removeListener`, `hasListener`, and `dispatch(...args)` to fire it from a test. Its `listeners` array is public, so tests can count listeners. |
| `storage.local`, `storage.session` | Map-backed. `get` works with a callback (called on a microtask) or as a promise, and returns clones. `set` and `remove` fire the shared `storage.onChanged` **synchronously** with `oldValue`/`newValue` and the area name. |
| `runtime` | `id`, `getURL()`, `lastError`, and `onMessage` / `onInstalled` / `onStartup` events. `sendMessage` records each message in `runtime.sent` and answers with `runtime.respond(message)` (set it per test; undefined by default), to the callback on a microtask and as a promise. |
| `scripting` | `registerContentScripts` (throws on a duplicate id, like the browser), `updateContentScripts`, `unregisterContentScripts`, `getRegisteredContentScripts`. Registrations are in `scripting.registered`. |
| `permissions` | `contains`, `request`, `remove`, and `onAdded` / `onRemoved`. Granted origins are in `permissions.granted`; every `request` is recorded in `permissions.requested`. `request` grants unless `permissions.allowRequest` is `false`; `remove` succeeds unless `permissions.allowRemove` is `false`. |
| `tabs` | `create` records into `tabs.created`; `sendMessage` and `query` answer with nothing. |
| `commands` | `onCommand` event. |
| `devtools` | `inspectedWindow.eval` returns whatever `inspectedWindow.evalHandler(expression)` returns (set it per test); `network.onNavigated` / `onRequestFinished` events; `getHAR` returns no entries; `panels.create` records `[title, page]` in `panels.created` and calls back at once. |

`fakeChrome.reset()` clears stored data, registrations, grants and recorded requests, recorded messages, tabs and panels, `lastError`, and resets `evalHandler`, `runtime.respond`, `allowRequest` and `allowRemove`. It keeps registered listeners, because source modules may have added them at import time.

## Conventions

- Call `fakeChrome.reset()` in a `beforeEach` in any file whose tests depend on storage or registrations. Every test file shares the one instance.
- Only implement what the source uses. When code starts using a new `chrome.*` call, add it here, matching the real API's behaviour where the code depends on it.
