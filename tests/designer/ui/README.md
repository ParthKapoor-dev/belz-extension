# `tests/designer/ui/`

Unit tests for the shared UI pieces in [`src/designer/ui/`](../../../src/designer/ui/) that several features use.

## Contents

| File | What it does |
|---|---|
| [`hover-overlay.test.ts`](hover-overlay.test.ts) | Tests `HoverOverlay` from [`hover-overlay.ts`](../../../src/designer/ui/hover-overlay.ts). |
| [`modal-lock.test.ts`](modal-lock.test.ts) | Tests `ModalLock` from [`modal-lock.ts`](../../../src/designer/ui/modal-lock.ts). |
| [`rebuild.test.ts`](rebuild.test.ts) | Tests that [`Toast`](../../../src/designer/ui/toast.ts) and [`SettingsModal`](../../../src/designer/features/settings/modal.ts) rebuild after the host app wipes `<body>` (the modal also releases the modal lock it held), and that the settings modal repaints from the settings store while open and stops on close. |

## What is covered

**`HoverOverlay`**

- The controls appear (`display: flex`) over an element that `resolveTarget` accepts, and hide after the grace period when the pointer moves off.
- One controls element serves the whole page, however many targets are hovered.
- A button's `onClick` receives the current target.
- Elements inside the extension's own UI (`data-sd-extension-owned="true"`) are never decorated.
- `stop()` removes the controls and the listeners.

**`ModalLock`**

- Locks nest: the page stays fixed until the last `unlock()`, which restores the body's previous `overflow`.
- An extra `unlock()` is harmless.

## How it works

- happy-dom does no layout, so `visibleBox()` stubs an element's `getBoundingClientRect()`. Hovering is a synthetic `mouseover` at a point inside that box.
- Each overlay test builds a fresh `HoverOverlay` with id `testOverlay`, and `afterEach` calls `stop()` on it.
- `modal-lock.test.ts` uses its own `new ModalLock()`, not the page-wide `modalLock` singleton.

## Conventions

The overlay's target is a DOM element. Compare identities inside `expect()` (`expect(overlay!.active === t).toBe(true)`), never the elements themselves. See [`../../README.md`](../../README.md).
