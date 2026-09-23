# `src/designer/features/title-updater/`

Names the browser tab after the open method or page, as `AD: <method>` or `PD: <page>`, so many open designer tabs can be told apart. Runs in the content script on AD and PD pages. Switched by the `titleUpdater` setting.

## Contents

| File | What it does |
|---|---|
| [`index.ts`](index.ts) | `TitleUpdater`, a `Feature` |

## How it works

`start()` subscribes `update()` to `pageObserver`, so it runs at once and after every DOM change. `update()` picks the name by path:

- path starts with `AD_ROUTE_PREFIX`: `extractMethodName()`, prefix `AD`;
- path starts with `PD_ROUTE_PREFIX`: `extractPageName()`, prefix `PD`.

It writes `document.title` only when the name is found and differs from the last one written. Before its first write it records the page's own title (and records it again if the app has set a title of its own since).

`stop()` unsubscribes and puts the page's own title back, but only if the tab still shows the title `TitleUpdater` wrote: a title the app set after it is the app's and is left alone. Started again, it writes the title again.

## How it connects

- **Used by:** `ad-content.ts` and `pd-content.ts`.
- **Depends on:** `core/observer.ts`, `utils/dom.ts`, `config/routes.ts`, and through `utils/dom.ts` the `AD.methodNameInput` and `PD.pageTitle` selectors.

## Testing

[`tests/designer/features/title-updater.test.ts`](../../../../tests/designer/features/title-updater.test.ts) covers the title and its restoring. The name helpers are covered by [`tests/designer/features/page-helpers.test.ts`](../../../../tests/designer/features/page-helpers.test.ts). How to run it is in the Development section of the [root README](../../../../README.md).
