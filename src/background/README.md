# `src/background/`

The extension's background context: a service worker in Chromium, a background script in Firefox
(the per-browser split is made by `browserManifest()` in
[`scripts/manifests.mjs`](../../scripts/manifests.mjs), which [`scripts/pack.mjs`](../../scripts/pack.mjs)
writes out). It has no UI. It
owns the site list and decides which sites the content scripts run on, answers the few messages other
worlds send it, and handles the browser-level keyboard shortcuts.

## Contents

| File / directory | What it does |
|---|---|
| [`index.ts`](index.ts) | Entry, built to `dist/background.js`. Only constructs and starts `ContentScriptSync`, `MessageRelay` and `CommandHandler`. |
| [`content-scripts.ts`](content-scripts.ts) | `ContentScriptSync`, the site list's only writer: makes the options page's edits, keeps the list's `enabled` flags in step with the browser's permissions and the registered content scripts in step with the list; `reconcileContentScripts()` is one pass; `seedHostsIfEmpty()` restores the list from `sites.default.json`. |
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
2. **One queue.** Everything `ContentScriptSync` does to the list or the registrations runs one task at
   a time in one promise chain (`enqueue()`): edits, grant syncs, seeding and reconciles, so no two of
   them read-modify-write the list at once. `reconcile()` waits for the running task, and every request
   that arrives before its pass starts shares it. It reads the list when it starts, so the latest list
   wins. It never rejects. `ContentScriptSync.start()` calls it on any `storage.onChanged` that touches
   the host list (`isHostsChange()`), and it runs after every grant sync and edit.
3. **Grant sync.** A permission can change outside the options page (the browser's own extension
   settings). `ContentScriptSync.syncGrants()` stores each `enabled` flag as `chrome.permissions.contains`
   reports it (`readGrants()` from [`shared/hosts.ts`](../shared/hosts.ts); a granted seeded entry
   loses `seeded`), in the queue, then reconciles, so a revoked host's scripts are unregistered and a
   granted one's registered. It runs on `permissions.onAdded` / `onRemoved`, `runtime.onStartup`, and
   `runtime.onInstalled` (after `seedHostsIfEmpty()`, which runs in the queue too).
4. **The options page's edits.** The options page never writes the list: it sends a `HostsEdit`
   ([`shared/messages.ts`](../shared/messages.ts)), which `ContentScriptSync.onMessage` accepts only
   whole-shape and only from the options page itself (`isFromOptionsPage()`). `edit()` makes it in the
   queue and answers `{ ok: true }` or `{ ok: false, error }`. The host must be a normalised hostname.
   `add` (sent once the browser granted the permission) lists the host at the end, or marks a listed
   one granted in place; it is refused unless the browser holds the permission. `revoke` (sent once the
   browser removed the permission) drops the entry, keeping the others' order; it is refused while the
   browser still holds the permission. `designerHost` sets a listed host's designer host
   (normalised) or clears it with `''`.
5. **Seeding.** `seedHostsIfEmpty()` fetches `SITES_SEED_FILE` from the extension root when storage has
   no host key at all. Each seeded `host` and `designerHost` goes through `normalizeHost()`, like a host
   typed on the options page, and invalid ones are dropped. Seeded entries are stored
   `enabled: false, seeded: true`, because only a user gesture on the options page can grant a
   permission. A list the user emptied (`{hosts: []}`) is never re-seeded.
6. **Message relay.** `MessageRelay.onMessage` acts only on messages that pass the full-shape guards in
   [`shared/messages.ts`](../shared/messages.ts), and checks who sent them:
   - `PdRelayMessage`, only from this extension's own pages (`isFromExtensionPage()`: no tab, and a
     URL on the extension's origin), because Firefox
     gives DevTools panels no `chrome.tabs`. `__pdRelay: 'cmd'` forwards a well-formed `PdCommand` to
     the tab with `chrome.tabs.sendMessage` and passes the answer back (null on error).
     `__pdRelay: 'open'` opens the URL only when it is https on a granted site (`isAllowedUrl()` over
     `enabledHostSet()`), and answers `{ ok }`.
   - `TakeAutofillMessage`, only from this extension's content script (`isFromExtension()`, with a
     `sender.tab`) on an Automation Designer page of a granted https site. It answers with
     `takeHandoff()` from [`shared/autofill-handoff.ts`](../shared/autofill-handoff.ts), which removes
     the body so it can be read once; anyone else gets null. Takes run one at a time (a promise chain
     in `MessageRelay`), so two requests for one id cannot both read the body.
7. **Commands.** `open-settings` sends an `OpenSettingsMessage` (key `COMMAND_MESSAGE_KEY`) to the
   active tab, where the designer content script opens the in-page Settings modal.
   `focus-ad-network` and `focus-pd-inspector` call `writeFocusFlag()` from
   [`shared/focus-flag.ts`](../shared/focus-flag.ts), because no browser lets an extension open or
   switch DevTools panels; the open panel reacts to the flag.

## How it connects

- **Used by:** the browser, through `manifest.json` (`background`, `commands`).
- **Talks to:** the [options page](../options/) (its `HostsEdit` messages, and the host list in
  storage), the
  [PD Inspector panel](../devtools/pd-inspector/) and its page engine in
  [`pd-inspector-page/`](../pd-inspector-page/) (relay), the designer content scripts in
  [`designer/`](../designer/) (open-settings, autofill handoff), the
  [AD Network panel](../devtools/ad-network/) (which stores the handoff), both DevTools panels
  (focus flag).
- **Depends on:** [`config/`](../config/) (routes, extension files, storage keys, namespace),
  [`shared/`](../shared/) (hosts, messages, autofill handoff, focus flag, logger), and the
  `chrome.scripting`, `chrome.storage`, `chrome.permissions`, `chrome.tabs`, `chrome.commands` APIs.

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
unhandled rejections, permissions removed or granted outside the options page, the options page's
edits, a grant and a revoke at once) and `seedHostsIfEmpty`.
[`tests/background/relay.test.ts`](../../tests/background/relay.test.ts) covers `MessageRelay` (sender
and payload checks, the `open` allow-list, the autofill handoff, two takes of one id at once) and
`CommandHandler`. Both use the
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
