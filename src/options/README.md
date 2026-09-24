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
| [`options-page.ts`](options-page.ts) | `OptionsPage`: all of the page's logic — add, grant, revoke, the designer-host field, and rendering the list. `start()` / `stop()` like the panels. It asks the browser for permissions and the background for every change to the list. |

## How it works

1. **Start.** The constructor stores nothing; `start()` finds the page's elements with `required()`,
   wires the form and the listeners, and paints.
2. **Changes go through the background.** The page never writes the list. Each change is a
   `HostsEdit` message (`sendEdit()`), which the background makes one at a time, in the same queue as
   its grant syncs and reconciles, and answers with `{ ok }` or the reason it refused, shown under the
   list. See [`src/background/`](../background/).
3. **Add and Grant.** On submit, `normalizeHost()` turns the input into a bare hostname.
   `requestAndAdd()` calls `chrome.permissions.request` for `hostPattern(host)` (`https://<host>/*`)
   first, while still inside the user gesture, and only on a grant sends `add`, which lists the host,
   or marks a listed one (a seeded entry) granted rather than adding it twice. A row's **Grant** does
   the same. Sites are https only: the extension never asks for plain-http access.
4. **Render.** `refresh()` reads the list and asks the browser for each host's permission
   (`readGrants()` from [`shared/hosts.ts`](../shared/hosts.ts)), then renders. A granted host shows
   **Revoke**; an ungranted one shows a "not granted" badge and **Grant**. The browser, not the stored
   flag, decides which. The background stores the flags as the browser reports them whenever a
   permission changes, so the list is right even when this page was closed.
5. **Revoke.** `revoke()` removes the permission first, from the click (the browser may require a user
   gesture), then sends `revoke`: the background drops the entry and unregisters the host's scripts.
   If the browser refuses the removal, nothing changes and the page says so.
6. **Designer host.** Each row has an optional field for the host that serves the Automation Designer
   UI, saved (a `designerHost` edit) on blur or Enter. The AD Network panel reads it through `InspectedSite` and opens methods
   there. For "Open in draft" to fill in the inputs, the designer host must itself be in the list and
   granted: the autofill runs in a content script, which only runs on allowed sites.
7. The page repaints on host-list changes in storage and on `chrome.permissions.onAdded` /
   `onRemoved`, so changes made elsewhere show up.

The background ([`src/background/`](../background/)) is the list's only writer; it also registers or
unregisters the content scripts when the list changes.

## How it connects

- **Used by:** the browser, through `options_ui` in `manifest.json`.
- **Depends on:** [`shared/hosts.ts`](../shared/hosts.ts) (`normalizeHost`, `hostPattern`,
  `readHosts`, `readGrants`, `isHostsChange`), [`shared/messages.ts`](../shared/messages.ts)
  (`HostsEdit`), [`shared/dom.ts`](../shared/dom.ts) (`required()`),
  [`shared/errors.ts`](../shared/errors.ts) (`errorText()`), [`shared/logger.ts`](../shared/logger.ts),
  and the `chrome.permissions`, `chrome.runtime` (messages) and `chrome.storage` APIs.
- **Read by others:** the host list is read by [`src/background/`](../background/),
  [`src/devtools/panel-registrar.ts`](../devtools/panel-registrar.ts) and
  [`src/devtools/ad-network/origin.ts`](../devtools/ad-network/origin.ts).

## Conventions

- `chrome.permissions.request` must be the first `await` in a click or submit handler, or the browser
  rejects it for lacking a user gesture.
- The storage shape and its validation belong to [`shared/hosts.ts`](../shared/hosts.ts), and every
  write to the list to the background. Never write the list from this page.
- See [AGENTS.md](../../AGENTS.md) ("Runtime host management") for the full host lifecycle.

## Testing

[`tests/options/options-page.test.ts`](../../tests/options/options-page.test.ts) drives `OptionsPage`
over the real `options.html` markup with the fake `chrome` and the background's `ContentScriptSync`
answering its messages (add, deny, grant, rows that follow the browser, revoke, a refused revoke that
changes nothing, a grant and a revoke at once, designer host, `stop()`). The host logic it uses is tested in
[`tests/shared/hosts.test.ts`](../../tests/shared/hosts.test.ts). To run the tests, see the root
[README](../../README.md#development)'s Development section.

## Adding or changing things

- **A new per-site field:** add it to `HostEntry` in [`shared/hosts.ts`](../shared/hosts.ts), add an
  input next to the designer host in `OptionsPage.designerRow()` (or a sibling method), and read it where it
  is needed.
