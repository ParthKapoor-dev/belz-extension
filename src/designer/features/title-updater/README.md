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

It writes `document.title` only when the name is found and differs from the last one written. `stop()` unsubscribes. It does not restore the original title.

## How it connects

- **Used by:** `ad-content.ts` and `pd-content.ts`.
- **Depends on:** `core/observer.ts`, `utils/dom.ts`, `config/routes.ts`, and through `utils/dom.ts` the `AD.methodNameInput` and `PD.pageTitle` selectors.

## Testing

The name helpers are covered by [`tests/designer/features/page-helpers.test.ts`](../../../../tests/designer/features/page-helpers.test.ts). How to run it is in the Development section of the [root README](../../../../README.md).
