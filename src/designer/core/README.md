# `src/designer/core/`

The lifecycle machinery of the designer content scripts: how features are started and stopped, where the page's settings live, and how features learn that the page changed. Runs in the content script on AD and PD pages.

## Contents

| File | What it does |
|---|---|
| [`bootstrap.ts`](bootstrap.ts) | `bootstrap(features)`: waits for the DOM, then starts and stops each feature as its setting changes (`FeatureSwitchboard`), and starts `SettingsLauncher`. Returns a teardown |
| [`feature.ts`](feature.ts) | The `Feature` interface: `start()` and `stop()` |
| [`settings.ts`](settings.ts) | `SettingsStore` and the `settings` singleton: the page's live copy of the settings, kept in step with `chrome.storage.local` |
| [`observer.ts`](observer.ts) | `PageObserver` and the `pageObserver` singleton: one `MutationObserver` shared by every feature |
| [`rearm.ts`](rearm.ts) | `Rearm`: re-attaches a feature's listeners a few times while the host app boots |

## How it works

1. An entry (`ad-content.ts` or `pd-content.ts`) calls `bootstrap()` with a map of setting key to `Feature`.
2. `bootstrap()` creates a `FeatureSwitchboard` and subscribes it to `settings`. The first call gets the current snapshot (the defaults until storage has been read). The next comes when `chrome.storage` has been read, and then one on every change.
3. For each key, the switchboard calls `start()` when the setting is on and `stop()` when it is off. A feature whose `start()` throws is logged and not marked running, so the next settings change retries it.
4. `bootstrap()` returns a teardown function: it removes the `DOMContentLoaded` listener, unsubscribes from `settings`, stops every running feature (`FeatureSwitchboard.stopAll()`) and calls `SettingsLauncher.stop()`. The entries never call it; tests do, so no bootstrap outlives its test.

**`SettingsStore`** takes a `SettingsStorage` (`read`, `write`, `watch`). In the extension this is `chromeSettingsStorage()`; tests pass an in-memory one. Every value goes through `sanitizeSetting` / `sanitizeSettings` from `config/settings.ts`, so a stale or invalid stored value falls back to its default. `subscribe()` calls the listener at once and then on every change.

**`PageObserver`** watches `document.body` (`childList`, `subtree`) only while it has subscribers. A `MutationObserver` cannot see changes inside shadow roots, so a 2 s poll also runs. It fires subscribers only when the count of all elements has changed.

**`Rearm`** calls its `attach` function at each delay in `TIMINGS.rearmDelays` and on the window's `load` and `pageshow` events. The designers are SPAs that finish booting after the content script runs, and listeners added too early were seen to stop receiving events. `attach` must be idempotent (remove, then add). `HoverOverlay` and `KeyboardShortcuts` use it.

## How it connects

- **Used by:** the two entries (`bootstrap`), every feature (`Feature`, and often `pageObserver` or `settings`), `ui/hover-overlay.ts` (`Rearm`), the settings modal and the editor modal (`settings`).
- **Depends on:** `config/settings.ts` (schema and validation), `config/storage-keys.ts` (`SETTINGS_STORAGE_KEY`), `config/timings.ts` (`rearmDelays`), `shared/logger.ts`, and `features/settings/` (`SettingsLauncher`).

## Conventions

- A `Feature`'s `start()` and `stop()` must each be safe to call twice, and `stop()` must undo everything `start()` did. Event handlers are arrow-function properties so `removeEventListener` gets the same function.
- `settings.ts` and `observer.ts` hold page-wide state. They carry a `belz-singleton` marker and must be bundled once (see [AGENTS.md](../../../AGENTS.md)).
- This folder only holds the live copy of the settings. The list of settings is in `config/settings.ts`.

## Testing

[`tests/designer/core/lifecycle.test.ts`](../../../tests/designer/core/lifecycle.test.ts) covers `PageObserver` and `bootstrap` (start/stop per setting, retry after a failed start, the teardown). [`tests/designer/core/settings.test.ts`](../../../tests/designer/core/settings.test.ts) covers `SettingsStore` and `chromeSettingsStorage`. How to run them is in the Development section of the [root README](../../../README.md).

## Adding or changing things

- **New setting:** add one entry to `config/settings.ts`. The store and the settings modal pick it up. If it switches a feature, use its key in the entry's `bootstrap()` call.
- **Feature that reacts to DOM changes:** call `pageObserver.subscribe()` in `start()` and call the returned function in `stop()`. Prefer event delegation where possible (as `HoverOverlay` does): every subscriber runs on every mutation.
