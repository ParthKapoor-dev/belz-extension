# `src/options/`

The extension's options page, titled **belz DevTools options**: the **Allowed sites** list. The
extension ships with no host permissions, and this page is where the user adds a site, grants or
revokes its permission, and sets an optional designer host. It runs as its own extension page
(`options_ui` in `manifest.json`). It is not the in-page **Settings** modal (the ⚙ button on AD and PD
pages, in [`designer/features/settings/`](../designer/features/settings/)), which holds the feature
settings.

## Contents

| File / directory | What it does |
|---|---|
| [`options.html`](options.html) | Page markup, styles and help text. Ships as `options.html` at the extension root and loads `dist/options.js`. |
| [`index.ts`](index.ts) | Entry, built to `dist/options.js`: constructs and starts an `OptionsPage`. |
| [`options-page.ts`](options-page.ts) | `OptionsPage`: all of the page's logic — add, grant, revoke, the designer-host field, and rendering the list. `start()` / `stop()` like the panels. |

## How it works

1. **Start.** The constructor stores nothing; `start()` finds the page's elements with `required()`,
   wires the form and the listeners, and paints.
2. **Add.** On submit, `normalizeHost()` turns the input into a bare hostname. `OptionsPage.add()` calls
   `chrome.permissions.request` for `hostPattern(host)` (`https://<host>/*`) first, while still inside
   the user gesture, and only on a grant writes the entry (`enabled: true`) with `writeHosts()`. A
   seeded entry that is granted this way is marked enabled rather than added twice. Sites are https
   only: the extension never asks for plain-http access.
3. **Render.** `refresh()` reads the list, asks `chrome.permissions.contains` for each host
   (`withGrantState()`), fixes any stored `enabled` flag that disagrees (`syncEnabledFlags()`), and
   renders. A granted host shows **Revoke**; an ungranted one shows a "not granted" badge and
   **Grant**. The browser, not storage, decides which.
4. **Revoke.** `revoke()` removes the permission first, then drops the entry from storage (only if the
   browser agreed). The background sees the storage change and unregisters the host's scripts.
5. **Designer host.** Each row has an optional field for the host that serves the Automation Designer
   UI, saved on blur or Enter. The AD Network panel reads it through `InspectedSite` and opens methods
   there. For "Open in draft" to fill in the inputs, the designer host must itself be in the list and
   granted: the autofill runs in a content script, which only runs on allowed sites.
6. The page repaints on host-list changes in storage and on `chrome.permissions.onAdded` /
   `onRemoved`, so changes made elsewhere show up.

The page only writes the list. The background ([`src/background/`](../background/)) watches the same
storage key and registers or unregisters the content scripts.

## How it connects

- **Used by:** the browser, through `options_ui` in `manifest.json`.
- **Depends on:** [`shared/hosts.ts`](../shared/hosts.ts) (`normalizeHost`, `hostPattern`,
  `readHosts`, `writeHosts`, `isHostsChange`), [`shared/dom.ts`](../shared/dom.ts) (`required()`),
  [`shared/errors.ts`](../shared/errors.ts) (`errorText()`), [`shared/logger.ts`](../shared/logger.ts),
  and the `chrome.permissions` and `chrome.storage` APIs.
- **Read by others:** the host list is read by [`src/background/`](../background/),
  [`src/devtools/panel-registrar.ts`](../devtools/panel-registrar.ts) and
  [`src/devtools/ad-network/origin.ts`](../devtools/ad-network/origin.ts).

## Conventions

- `chrome.permissions.request` must be the first `await` in a click or submit handler, or the browser
  rejects it for lacking a user gesture.
- The storage shape and its validation belong to [`shared/hosts.ts`](../shared/hosts.ts). Change them
  there, not here.
- See [AGENTS.md](../../AGENTS.md) ("Runtime host management") for the full host lifecycle.

## Testing

[`tests/options/options-page.test.ts`](../../tests/options/options-page.test.ts) drives `OptionsPage`
over the real `options.html` markup with the fake `chrome` (add, deny, grant sync, revoke, designer
host, `stop()`). The host logic it uses is tested in
[`tests/shared/hosts.test.ts`](../../tests/shared/hosts.test.ts). To run the tests, see the root
[README](../../README.md#development)'s Development section.

## Adding or changing things

- **A new per-site field:** add it to `HostEntry` in [`shared/hosts.ts`](../shared/hosts.ts), add an
  input next to the designer host in `OptionsPage.designerRow()` (or a sibling method), and read it where it
  is needed.
