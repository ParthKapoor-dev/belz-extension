# `src/designer/ui/`

UI building blocks shared by the designer features: the floating hover overlay, the modal lock, the toast, and the style tokens every injected element uses. Runs in the content script on AD and PD pages.

## Contents

| File | What it does |
|---|---|
| [`hover-overlay.ts`](hover-overlay.ts) | `HoverOverlay`: one floating button group, placed over whichever element the pointer or focus is on |
| [`modal-lock.ts`](modal-lock.ts) | `ModalLock` and the `modalLock` singleton: freezes page scroll and blocks page shortcuts while any modal is open |
| [`toast.ts`](toast.ts) | `Toast` and the `toast` singleton: a short message in the bottom-right corner |
| [`modal.ts`](modal.ts) | Shared inline-style objects for modal overlay, dialog, header, footer, title and icon button |
| [`styles.ts`](styles.ts) | Icon and primary button styles, the `StyleMap` type, and `applyHoverEffect()` |
| [`theme.ts`](theme.ts) | Design tokens: the colour palette `T`, `FONT_MONO`, `RADIUS`, `SHADOW`, `SCRIM` |

## How it works

**`HoverOverlay`** takes a `HoverOverlayConfig`: an element id, a `resolveTarget(node, event)` function that picks the element to attach to, a list of buttons, and optionally `sizeFor` and `inset`.

1. `start()` adds capture-phase listeners on `document` (`mouseover`, `focusin`, `focusout`, `input`, `scroll`) and a `resize` listener on `window`, and starts a `Rearm`.
2. On hover or focus, it reads `event.composedPath()[0]`, so elements inside open shadow roots are found. Anything inside `[EXTENSION_OWNED_ATTR]` is ignored. `resolveTarget` decides the target.
3. The controls node is built on first use and appended to `document.body`. It is rebuilt if the host app removed it.
4. It is positioned at the target's top-right corner. Scroll, resize and input reposition it through `requestAnimationFrame`, with a 32 ms `setTimeout` backstop because rAF does not run in background tabs.
5. When the pointer leaves, it hides after a 120 ms grace period, so the pointer can reach the buttons.

Because it uses delegation, elements added later need no registration and no rescan. It never changes the page's own markup.

**`ModalLock`** counts `lock()` / `unlock()` calls, so nested modals work (the settings modal over the editor). On the first lock it saves the body styles and scroll position and fixes the body in place. On the last unlock it restores them. `KeyboardShortcuts` checks `modalLock.isLocked` and does nothing while it is set.

**`Toast`** reuses one element (marked `EXTENSION_OWNED_ATTR`) and fades it out after 1.2 s. If the host app wiped it from the page, the next `show()` builds a new one.

## How it connects

- **Used by:** `OutputCopy` and `TextareaEditor` each own a `HoverOverlay`. The JSON editor, settings and textarea editor modals take `modalLock`. Most features call `toast.show()`. The modals and buttons use `modal.ts`, `styles.ts` and `theme.ts`.
- **Depends on:** `core/rearm.ts`, `config/namespace.ts` (`EXTENSION_OWNED_ATTR`), `shared/logger.ts`.

## Conventions

- Styling is inline: style objects applied with `Object.assign(el.style, ...)`. Take colours and fonts from `theme.ts` rather than new literals.
- `modal-lock.ts` and `toast.ts` hold page-wide state and carry a `belz-singleton` marker. They must be bundled once, or the lazily loaded editor would lock a different copy than the one the shortcuts check (see [AGENTS.md](../../../AGENTS.md)).
- Every modal calls `modalLock.lock()` when it opens and `unlock()` when it closes, exactly once each.

## Testing

[`tests/designer/ui/hover-overlay.test.ts`](../../../tests/designer/ui/hover-overlay.test.ts) covers showing and hiding, the single controls element, button clicks, skipping the extension's own UI, and `stop()`. [`tests/designer/ui/modal-lock.test.ts`](../../../tests/designer/ui/modal-lock.test.ts) covers the lock. The e2e run ([`tests/e2e/`](../../../tests/e2e/)) checks that the lazy editor and the eager shortcut share one lock. How to run them is in the Development section of the [root README](../../../README.md).

## Adding or changing things

- **A new hover button on some kind of element:** create a `HoverOverlay` in a feature class with a new `ns()` id and a `resolveTarget`, and call its `start()` / `stop()` from the feature's. Keep `resolveTarget` cheap: it runs on every `mouseover`.
- **A new modal:** use the `MODAL_*` styles from `modal.ts`, mark the overlay with `EXTENSION_OWNED_ATTR`, and take and release `modalLock`.
