# `src/background/`

The extension's background context: a service worker in Chromium, a background script in Firefox
(the per-browser split is made by [`scripts/pack.mjs`](../../scripts/pack.mjs)). It has no UI. It
decides which sites the content scripts run on, relays messages for the PD Inspector panel, and
handles the browser-level keyboard shortcuts.

## Contents

| File / directory | What it does |
|---|---|
| [`index.ts`](index.ts) | Entry, built to `dist/background.js`. Wires the browser event listeners, the PD panel relay and the `chrome.commands` handler. |
| [`content-scripts.ts`](content-scripts.ts) | `reconcileContentScripts()` registers content scripts per allowed host; `seedHostsIfEmpty()` restores the host list from `sites.default.json`. |

## How it works

1. **Content-script registration.** The manifest declares no content scripts. `reconcileContentScripts()`
   reads the granted hosts (`readEnabledHosts()` from [`shared/hosts.ts`](../shared/hosts.ts)) and makes
   the registered scripts match. Each host gets one registration per entry in `CONTENT_SCRIPT_TEMPLATES`:
   `ad-<host>` (`dist/ad-content.js`), `pd-<host>` (`dist/pd-content.js`) and `pdi-<host>`
   (`dist/pd-inspector.js`), on the route prefixes from [`config/routes.ts`](../config/routes.ts).
   Scripts no longer wanted are unregistered, new ones registered, existing ones updated.
   `index.ts` runs it on `runtime.onInstalled`, `runtime.onStartup`, and on any `storage.onChanged`
   that touches the host list (`isHostsChange()`).
2. **Seeding.** On `onInstalled`, before reconciling, `seedHostsIfEmpty()` fetches `sites.default.json`
   from the extension root if storage has no host key at all. Seeded entries are stored
   `enabled: false, seeded: true`, because only a user gesture on the options page can grant a
   permission. A list the user emptied (`{hosts: []}`) is never re-seeded.
3. **PD panel relay.** Firefox gives DevTools panels no `chrome.tabs`. The PD Inspector panel
   therefore sends a `PdRelayMessage` (see [`shared/messages.ts`](../shared/messages.ts)) here:
   `__pdRelay: 'cmd'` is forwarded to the inspected tab with `chrome.tabs.sendMessage` and the
   answer is passed back (null on error); `__pdRelay: 'open'` opens a URL in a new tab.
4. **Commands.** `open-settings` sends an `OpenSettingsMessage` to the active tab, where the designer
   content script opens its settings modal. `focus-ad-network` and `focus-pd-inspector` call
   `writeFocusFlag()` from [`shared/focus-flag.ts`](../shared/focus-flag.ts), because no browser
   lets an extension open or switch DevTools panels; the open panel reacts to the flag.

## How it connects

- **Used by:** the browser, through `manifest.json` (`background`, `commands`).
- **Talks to:** the [options page](../options/) (through the host list in storage), the
  [PD Inspector panel](../devtools/pd-inspector/) and its page engine in
  [`pd-inspector-page/`](../pd-inspector-page/) (relay), the designer content scripts in
  [`designer/`](../designer/) (open-settings), both DevTools panels (focus flag).
- **Depends on:** [`config/`](../config/) (routes, storage keys), [`shared/`](../shared/) (hosts,
  messages, focus flag, logger), and the `chrome.scripting`, `chrome.storage`, `chrome.tabs`,
  `chrome.commands` APIs.

## Conventions

- `index.ts` acts on import, so it stays thin wiring. Logic that needs tests goes in an importable
  module such as `content-scripts.ts`. See [AGENTS.md](../../AGENTS.md) ("Runtime host management").
- A new content script entry is a new item in `CONTENT_SCRIPT_TEMPLATES`, with a stable id prefix.

## Testing

[`tests/background/content-scripts.test.ts`](../../tests/background/content-scripts.test.ts) covers
`reconcileContentScripts` and `seedHostsIfEmpty` against the fake `chrome` in
[`tests/fakes/chrome.ts`](../../tests/fakes/chrome.ts). To run the tests, see the root
[README](../../README.md#development)'s Development section.

## Adding or changing things

- **Registering another content script per host:** add a template to `CONTENT_SCRIPT_TEMPLATES`,
  add its route prefix to [`config/routes.ts`](../config/routes.ts), and add the bundle to
  `scripts/build.mjs`. Follow the entry-point checklist in [AGENTS.md](../../AGENTS.md).
- **A new browser shortcut:** declare it under `commands` in `manifest.json`, then handle its name in
  the `chrome.commands.onCommand` listener in `index.ts`.
- **A new relayed message:** add its shape and guard to [`shared/messages.ts`](../shared/messages.ts)
  first, then handle it in the `runtime.onMessage` listener.
