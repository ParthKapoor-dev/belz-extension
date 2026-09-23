# `src/designer/features/settings/`

The way to open the extension's settings on a designer page, and the settings modal itself. Runs in the content script on AD and PD pages. Always on: it has no setting of its own, so it is always there to turn features back on.

## Contents

| File | What it does |
|---|---|
| [`index.ts`](index.ts) | `SettingsLauncher`: the ⚙ button in the page header, Ctrl+, / Alt+, and the relayed browser command |
| [`modal.ts`](modal.ts) | `SettingsModal` and the `settingsModal` singleton: one row per setting, written to the settings store on change |

## How it works

**Opening.** `bootstrap()` calls `new SettingsLauncher().start()` once. It opens `settingsModal` from three places:

- A ⚙ button appended to the page title (`HEADER.banner` then `HEADER.title`). It is added after `TIMINGS.settingsButtonFirstTry`, and put back, debounced by `TIMINGS.settingsButtonDebounce`, after page changes (the AD app re-renders its header).
- Ctrl+, or Alt+, (exactly one of the two). Firefox and Zen take Ctrl+, before the page sees it, so Alt+, is accepted too.
- An `OpenSettingsMessage` from the background, sent when the user presses the `open-settings` browser command (Alt+Shift+S by default). Checked with `isOpenSettings()` from `shared/messages.ts`.

**The modal.** `SettingsModal` builds its DOM on first open. Rows come from `settingsIn(section)` in `config/settings.ts`: a switch for a toggle, a dropdown for a select. Sections are `features` (no title), `editor` ("Textarea Editor Defaults") and `advanced` ("Advanced"). Each change calls `settings.set(key, value)`, which saves to `chrome.storage.local` and notifies every subscriber, so features start or stop at once. While open it subscribes to the store, so the rows repaint when a setting changes elsewhere (another tab); `close()` unsubscribes. It uses the shared `MODAL_*` shell from `ui/modal.ts`. If the host app wiped it from the page, the next `open()` drops it (releasing its `modalLock` hold) and rebuilds it. The modal takes `modalLock` while open and closes on Escape, **Done**, × or a click on the backdrop.

## How it connects

- **Used by:** `core/bootstrap.ts` (`SettingsLauncher`) and the large editor's ⚙ button (`settingsModal.open()` in `textarea-editor/modal.ts`).
- **Depends on:** `core/settings.ts`, `core/observer.ts`, `config/settings.ts`, `HEADER` in `config/selectors.ts`, `config/timings.ts`, `config/namespace.ts`, `ui/modal-lock.ts`, `ui/modal.ts`, `ui/styles.ts`, `ui/theme.ts`, `shared/messages.ts`, `chrome.runtime.onMessage`.

## Conventions

- The modal never lists settings itself. `config/settings.ts` is the only list, and the rows follow from it.
- `modal.ts` holds page-wide state and has a `belz-singleton` marker: the eager launcher and the lazily loaded editor must open the same modal.
- `SettingsLauncher` is not a `Feature` and has no `stop()`; it lives as long as the page. That is why the flex layout it gives the page title to hold the ⚙ button is never undone.

## Testing

[`tests/designer/ui/rebuild.test.ts`](../../../../tests/designer/ui/rebuild.test.ts) covers the modal following the store while open and rebuilding after the body is wiped. The store behind it is covered by [`tests/designer/core/settings.test.ts`](../../../../tests/designer/core/settings.test.ts) and the schema by [`tests/config/settings.test.ts`](../../../../tests/config/settings.test.ts). How to run them is in the Development section of the [root README](../../../../README.md).

## Adding or changing things

To add a setting, add one entry to `SETTINGS` in `config/settings.ts` with its `section`. The modal shows it without changes here. A new section needs a new `appendSection()` call in `SettingsModal.ensureOverlay()`.
