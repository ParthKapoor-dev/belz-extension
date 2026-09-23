# `src/designer/features/output-copy/`

A copy button (⧉) that appears when the pointer is over an output container. It copies the container's text. Runs in the content script on AD and PD pages. Switched by the `outputCopy` setting.

## Contents

| File | What it does |
|---|---|
| [`index.ts`](index.ts) | `OutputCopy`, a `Feature` that owns one `HoverOverlay` |

## How it works

1. `OutputCopy` builds a `HoverOverlay` (from `ui/hover-overlay.ts`) with the id `ns('OutputCopyControls')` and one button. `start()` / `stop()` start and stop the overlay.
2. `resolveOutputContainer()` returns `node.closest(AD.outputContainer)`. It returns null for a textarea, including a disabled one found with `textareaUnderPointer()`, so the textarea editor's overlay gets that spot instead.
3. On click, `extractOutputText()` clones the container, removes any `[EXTENSION_OWNED_ATTR]` nodes from the clone, and copies its text with `copyText()`. A toast reports the result.

There is one controls element for the whole page. The page's markup is not changed.

## How it connects

- **Used by:** `ad-content.ts` and `pd-content.ts`.
- **Depends on:** `ui/hover-overlay.ts`, `ui/styles.ts`, `ui/toast.ts`, `utils/clipboard.ts`, `utils/dom.ts`, `AD.outputContainer` in `config/selectors.ts`, `config/namespace.ts`.

## Testing

The overlay behaviour is covered by [`tests/designer/ui/hover-overlay.test.ts`](../../../../tests/designer/ui/hover-overlay.test.ts). How to run it is in the Development section of the [root README](../../../../README.md).
