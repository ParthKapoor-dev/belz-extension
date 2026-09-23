# `tests/background/`

Unit tests for the background service worker's logic in [`src/background/`](../../src/background/): registering content scripts per allowed host, seeding the host list, the message relay, and the browser-level keyboard commands.

## Contents

| File | Source under test | What it covers |
|---|---|---|
| [`content-scripts.test.ts`](content-scripts.test.ts) | [`content-scripts.ts`](../../src/background/content-scripts.ts) | `ContentScriptSync`, `reconcileContentScripts()` and `seedHostsIfEmpty()`. |
| [`relay.test.ts`](relay.test.ts) | [`relay.ts`](../../src/background/relay.ts), [`commands.ts`](../../src/background/commands.ts) | `MessageRelay` (PD Inspector relay and the autofill handoff) and `CommandHandler`. |

## What is covered

**`ContentScriptSync`**

- Reconciles started together never register one id twice. Unserialised `reconcileContentScripts()` calls still settle without throwing; through `reconcile()` no "Duplicate script ID" error happens at all.
- Requests made while a pass runs are coalesced into one more pass, which reads the latest host list.
- A host-list change reconciles; a failing step (here, unregistering) is logged, the other steps still run, and nothing is left as an unhandled rejection.
- A script registered behind its back (the list it read was stale) is updated rather than failing the pass.

**`reconcileContentScripts()`**

- Each enabled host gets three registrations with ids `ad-<host>`, `pd-<host>` and `pdi-<host>`. A disabled host gets none.
- The AD script matches `https://<host>/automation-designer/*` and loads `dist/ad-content.js`; the PD Inspector script loads `dist/pd-inspector.js`.
- A host removed from the list loses its scripts; the others stay. Running it twice changes nothing.

**`seedHostsIfEmpty()`**

- Restores the list from `sites.default.json`, each entry written `enabled: false, seeded: true`. Hosts and designer hosts go through `normalizeHost()` like typed ones (scheme, port, path and case stripped); empty or invalid entries are dropped.
- Does nothing when the user stored an empty list on purpose (`{hosts: []}`), and leaves storage untouched when the seed file is missing.

**`MessageRelay`**

- A well-formed PD command from an extension page is forwarded to the tab and its answer returned. A command from a content script or another extension, or a malformed one (wrong field type, unknown `cmd`, non-integer `tabId`), is ignored.
- `open` opens only an https URL on an enabled site; `javascript:`, plain http, other or disabled sites and `file:` are refused, and a content script cannot ask.
- The autofill handoff gives a stored body to this extension's content script on an AD page of an enabled site, once. Other sites, disabled sites, non-AD pages, other extensions and senders without a tab get `null`; an unknown or malformed id finds nothing.

**`CommandHandler`**

- `open-settings` sends the open-settings message to the active tab; the two focus commands write the focus flag for their panel; an unknown command does nothing.

## How it works

- The host list is written with `writeHosts()` from [`src/shared/hosts.ts`](../../src/shared/hosts.ts). Registrations are read back from `fakeChrome.scripting.registered`, forwarded messages from `fakeChrome.tabs.messages` and opened tabs from `fakeChrome.tabs.created` (see [`../fakes/`](../fakes/)).
- `relay.test.ts` calls `relay.onMessage()` directly with senders built by `extensionPageSender` and `contentScriptSender()` from the fake.
- Concurrency tests hold a pass open by wrapping `getRegisteredContentScripts` with a gate, and restore every wrapped fake method in `finally`. They listen for `unhandledRejection` on `process`.
- The seed file is served by replacing `globalThis.fetch`; the real `fetch` is restored after each test. `fakeChrome.reset()` runs before each test.

`src/background/index.ts` is not imported: it constructs and starts the three parts on import. Their logic lives in the modules above so it can be tested here.
