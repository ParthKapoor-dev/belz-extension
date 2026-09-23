# `src/designer/utils/`

Stateless helpers for the designer content scripts: reading names off the AD/PD page, hit-testing for textareas, and copying text to the clipboard.

## Contents

| File | What it does |
|---|---|
| [`dom.ts`](dom.ts) | `firstMatch()`, `textareaUnderPointer()`, `extractMethodName()`, `extractPageName()`, `extractServiceCategory()` |
| [`clipboard.ts`](clipboard.ts) | `copyText()`: copies text, with a fallback when the Clipboard API is not available |

## How it works

- **`firstMatch(root, selectors)`** tries each selector in order and returns the first element found. `config/selectors.ts` uses a list wherever the page has had more than one markup.
- **`textareaUnderPointer(event)`** hit-tests the event's coordinates with `document.elementFromPoint`. A `disabled` textarea receives no pointer events, so this is the only way to find one under the pointer. It returns null for events without coordinates, such as `focusin`.
- **`extractMethodName()`** reads `AD.methodNameInput`, **`extractServiceCategory()`** reads `AD.serviceCategory`, and **`extractPageName()`** reads the first of `PD.pageTitle`. Each returns null when the element is missing or empty.
- **`copyText(text)`** tries `navigator.clipboard.writeText`. If that fails, it puts the text in a hidden, off-screen textarea marked with `EXTENSION_OWNED_ATTR` and runs `document.execCommand('copy')`. It returns whether the copy succeeded.

## How it connects

- **Used by:** `TitleUpdater` (method and page names), `copyAdRichLink()` in `features/keyboard/ad-link.ts` (method name and category for the Shift+L link), `OutputCopy` and `TextareaEditor` (`textareaUnderPointer`, `copyText`), the JSON editor (`firstMatch`), and the editor modal (`copyText`).
- **Depends on:** `config/selectors.ts` (`AD`, `PD`), `config/namespace.ts`, `shared/logger.ts`.

## Conventions

Keep these functions stateless. Page selectors stay in `config/selectors.ts`; do not inline them here.

## Testing

[`tests/designer/features/page-helpers.test.ts`](../../../tests/designer/features/page-helpers.test.ts) covers the method, category and page-name helpers. How to run it is in the Development section of the [root README](../../../README.md).
