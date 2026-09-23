# `src/background/`

The extension's background context: a service worker in Chromium, a background script in Firefox
(the per-browser split is made by [`scripts/pack.mjs`](../../scripts/pack.mjs)). It has no UI. It
decides which sites the content scripts run on, answers the few messages other worlds send it, and
handles the browser-level keyboard shortcuts.

## Contents

| File / directory | What it does |
|---|---|
| [`index.ts`](index.ts) | Entry, built to `dist/background.js`. Only constructs and starts `ContentScriptSync`, `MessageRelay` and `CommandHandler`. |
| [`content-scripts.ts`](content-scripts.ts) | `ContentScriptSync` keeps the registered content scripts in step with the site list; `reconcileContentScripts()` is one pass; `seedHostsIfEmpty()` restores the list from `sites.default.json`. |
| [`relay.ts`](relay.ts) | `MessageRelay`: the PD Inspector relay and the "Open in draft" autofill handoff, for validated senders only. |
| [`commands.ts`](commands.ts) | `CommandHandler`: the `chrome.commands` shortcuts (`open-settings`, `focus-ad-network`, `focus-pd-inspector`). |

## How it works

1. **Content-script registration.** The manifest declares no content scripts.
   `reconcileContentScripts()` reads the granted hosts (`readEnabledHosts()` from
   [`shared/hosts.ts`](../shared/hosts.ts)), normalises each with `normalizeHost()`, and makes the
   registered scripts match. Each host gets one registration per entry in `CONTENT_SCRIPT_TEMPLATES`:
   `ad-<host>`, `pd-<host>` and `pdi-<host>`, with the files from `CONTENT_SCRIPT_FILES`
   ([`config/extension-files.ts`](../config/extension-files.ts)) on the route prefixes from
   [`config/routes.ts`](../config/routes.ts). Unwanted scripts are unregistered, new ones registered,
   existing ones updated. Each of the three steps is tried and logged on its own, so one failure
   does not leave the others undone. `registerContentScripts` is all-or-nothing, so when an id turns
   out to be registered already ("Duplicate script ID"), `register()` retries each script alone and
   updates the existing one instead.
2. **Serialised reconciles.** `ContentScriptSync.reconcile()` never runs two passes at once: a pass
   waits for the running one, and every request that arrives before it starts shares it. It reads the
   list when it starts, so the latest list wins. It never rejects. `ContentScriptSync.start()` calls it
   on `runtime.onInstalled` (after `seedHostsIfEmpty()`), `runtime.onStartup`, and any
   `storage.onChanged` that touches the host list (`isHostsChange()`).
3. **Seeding.** `seedHostsIfEmpty()` fetches `SITES_SEED_FILE` from the extension root when storage has
   no host key at all. Each seeded `host` and `designerHost` goes through `normalizeHost()`, like a host
   typed on the options page, and invalid ones are dropped. Seeded entries are stored
   `enabled: false, seeded: true`, because only a user gesture on the options page can grant a
   permission. A list the user emptied (`{hosts: []}`) is never re-seeded.
4. **Message relay.** `MessageRelay.onMessage` acts only on messages that pass the full-shape guards in
   [`shared/messages.ts`](../shared/messages.ts), and checks who sent them:
   - `PdRelayMessage`, only from this extension's own pages (`isFromExtensionPage()`), because Firefox
     gives DevTools panels no `chrome.tabs`. `__pdRelay: 'cmd'` forwards a well-formed `PdCommand` to
     the tab with `chrome.tabs.sendMessage` and passes the answer back (null on error).
     `__pdRelay: 'open'` opens the URL only when it is https on a granted site (`httpsHostOf()`,
     `enabledHostSet()`), and answers `{ ok }`.
   - `TakeAutofillMessage`, only from this extension's content script (`isFromExtension()`, with a
     `sender.tab`) on an Automation Designer page of a granted https site. It answers with
     `takeHandoff()` from [`shared/autofill-handoff.ts`](../shared/autofill-handoff.ts), which removes
     the body so it can be read once; anyone else gets null.
5. **Commands.** `open-settings` sends an `OpenSettingsMessage` (key `COMMAND_MESSAGE_KEY`) to the
   active tab, where the designer content script opens the in-page Settings modal.
   `focus-ad-network` and `focus-pd-inspector` call `writeFocusFlag()` from
   [`shared/focus-flag.ts`](../shared/focus-flag.ts), because no browser lets an extension open or
   switch DevTools panels; the open panel reacts to the flag.

## How it connects

- **Used by:** the browser, through `manifest.json` (`background`, `commands`).
- **Talks to:** the [options page](../options/) (through the host list in storage), the
  [PD Inspector panel](../devtools/pd-inspector/) and its page engine in
  [`pd-inspector-page/`](../pd-inspector-page/) (relay), the designer content scripts in
  [`designer/`](../designer/) (open-settings, autofill handoff), the
  [AD Network panel](../devtools/ad-network/) (which stores the handoff), both DevTools panels
  (focus flag).
- **Depends on:** [`config/`](../config/) (routes, extension files, storage keys, namespace),
  [`shared/`](../shared/) (hosts, messages, autofill handoff, focus flag, logger), and the
  `chrome.scripting`, `chrome.storage`, `chrome.tabs`, `chrome.commands` APIs.

## Conventions

- `index.ts` acts on import, so it only constructs and starts. Logic lives in the importable classes,
  which have `start()` / `stop()` and are tested without side effects. See
  [AGENTS.md](../../AGENTS.md) ("Runtime host management").
- Every listener is registered synchronously when the worker loads (`start()` runs at module level), as
  MV3 service workers require.
- No handler lets a rejection go unhandled: reconciles, storage writes and relay answers catch and log.
- A new content script entry is a new item in `CONTENT_SCRIPT_TEMPLATES`, with a stable id prefix.

## Testing

[`tests/background/content-scripts.test.ts`](../../tests/background/content-scripts.test.ts) covers
`reconcileContentScripts`, `ContentScriptSync` (concurrent and coalesced reconciles, duplicate ids, no
unhandled rejections) and `seedHostsIfEmpty`.
[`tests/background/relay.test.ts`](../../tests/background/relay.test.ts) covers `MessageRelay` (sender
and payload checks, the `open` allow-list, the autofill handoff) and `CommandHandler`. Both use the
fake `chrome` in [`tests/fakes/chrome.ts`](../../tests/fakes/chrome.ts). To run the tests, see the root
[README](../../README.md#development)'s Development section.

## Adding or changing things

- **Registering another content script per host:** add its file to `CONTENT_SCRIPT_FILES`, a template
  to `CONTENT_SCRIPT_TEMPLATES`, its route prefix to [`config/routes.ts`](../config/routes.ts), and the
  bundle to `scripts/build.mjs`. Follow the entry-point checklist in [AGENTS.md](../../AGENTS.md).
- **A new browser shortcut:** declare it under `commands` in `manifest.json`, then handle its name in
  `CommandHandler.onCommand`.
- **A new relayed message:** add its shape and a full-shape guard to
  [`shared/messages.ts`](../shared/messages.ts) first, then handle it in `MessageRelay.onMessage` with a
  sender check.
