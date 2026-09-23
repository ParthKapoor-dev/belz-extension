# `tests/background/`

Unit tests for the background service worker's logic in [`src/background/content-scripts.ts`](../../src/background/content-scripts.ts): registering content scripts per allowed host, and seeding the host list.

## Contents

| File | What it does |
|---|---|
| [`content-scripts.test.ts`](content-scripts.test.ts) | Tests `reconcileContentScripts()` and `seedHostsIfEmpty()`. |

## What is covered

**`reconcileContentScripts()`**

- Each enabled host gets three registrations with ids `ad-<host>`, `pd-<host>` and `pdi-<host>`. A disabled host gets none.
- The AD script matches `https://<host>/automation-designer/*` and loads `dist/ad-content.js`; the PD Inspector script loads `dist/pd-inspector.js`.
- A host removed from the list loses its scripts; the others stay.
- Running it twice changes nothing.

**`seedHostsIfEmpty()`**

- Restores the list from `sites.default.json`, normalising hosts (trim, lower-case), dropping empty entries, and writing each as `enabled: false, seeded: true`.
- Does nothing when the user stored an empty list on purpose (`{hosts: []}`).
- Leaves storage untouched when the seed file is missing.

## How it works

- The host list is written with `writeHosts()` from [`src/shared/hosts.ts`](../../src/shared/hosts.ts), and registrations are read back from `fakeChrome.scripting.registered` (see [`../fakes/`](../fakes/)).
- The seed file is served by replacing `globalThis.fetch`; the real `fetch` is restored after each test.
- `fakeChrome.reset()` runs before each test.

`src/background/index.ts` is not imported: it wires listeners on import. Its logic lives in `content-scripts.ts` so it can be tested here.
