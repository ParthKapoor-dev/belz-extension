# `tests/designer/`

Unit tests for [`src/designer/`](../../src/designer/), the content scripts that run on Automation Designer and Page Designer pages. They run against the happy-dom page set up by [`../setup.ts`](../setup.ts), rendering just enough host-page markup for each test.

## Contents

| Directory | What it does |
|---|---|
| [`core/`](core/) | `PageObserver`, `bootstrap()`, and the `SettingsStore` with its `chrome.storage` adapter. |
| [`features/`](features/) | One or more test files per feature: JSON editor, keyboard shortcuts, "Open in draft" autofill, Esc in the modals, title updater, `#{variable}` scanner and intellisense, language detection, page helpers. |
| [`ui/`](ui/) | `HoverOverlay`, `ModalLock`, and rebuilding after the body is wiped. |

There is no `utils/` folder: the helpers from `src/designer/utils/dom.ts` that are tested (`extractMethodName`, `extractPageName`, `extractServiceCategory`) are covered in [`features/page-helpers.test.ts`](features/page-helpers.test.ts).

## Conventions

- **Entries are not imported.** `ad-content.ts` and `pd-content.ts` start features on import. Tests construct the class or call the function they need, passing what the entry would pass (for example the `ShortcutActions` of each page in `features/shortcuts.test.ts`).
- **Markup comes from the test or a fixture.** Simple cases set `document.body.innerHTML` inline. Larger AD page structures come from [`../fixtures/`](../fixtures/).
- **Some tests use page-wide singletons** (for example `modalLock` in `features/shortcuts.test.ts`). Such a test must leave the singleton as it found it, since other files share it.
- **No DOM-holding value in `expect()`.** See [`../README.md`](../README.md) for why.
