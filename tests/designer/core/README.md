# `tests/designer/core/`

Unit tests for [`src/designer/core/`](../../../src/designer/core/): the page observer, the feature bootstrap, and the settings store.

## Contents

| File | What it does |
|---|---|
| [`lifecycle.test.ts`](lifecycle.test.ts) | Tests `PageObserver` and `bootstrap()`. |
| [`settings.test.ts`](settings.test.ts) | Tests `SettingsStore` and `chromeSettingsStorage()`. |

## What is covered

**`PageObserver`** ([`observer.ts`](../../../src/designer/core/observer.ts))

- A subscriber is called once at once, then after each DOM change, until it unsubscribes.
- A subscriber that throws does not stop the others.

**`bootstrap()`** ([`bootstrap.ts`](../../../src/designer/core/bootstrap.ts))

- Starts and stops each feature as its setting changes in `chrome.storage.local`, leaving the others alone. Features are `RecordingFeature` instances that log `start`/`stop`.
- A feature whose `start()` throws is retried on the next settings change.
- The teardown `bootstrap()` returns stops every running feature and the settings launcher (its `runtime.onMessage` listener goes), and later settings changes reach nothing. Every test calls it in `afterEach`, so no bootstrap outlives its test.

**`SettingsStore`** ([`settings.ts`](../../../src/designer/core/settings.ts))

- Starts with `DEFAULT_SETTINGS`, then loads what is stored.
- Picks up changes made elsewhere (another tab, the options page), sanitising them. A non-object change is ignored.
- `set()` persists and notifies subscribers; it ignores unknown keys and values that did not change.
- `get()` returns a copy.
- A subscriber that throws does not stop the others.

These tests pass a `memoryStorage()` helper as the store's `SettingsStorage`, so they can simulate "a change from elsewhere" directly. A store built with `null` storage is used where persistence does not matter.

**`chromeSettingsStorage()`** reads, writes and watches `chrome.storage.local` under the settings key, checked against `fakeChrome`.

## Conventions

Tests that go through `chrome.storage` call `fakeChrome.reset()` first. Like the browser, the fake fires `storage.onChanged` a task after `set()`, so a test awaits the write and then one more task (`writeSettings()` in `lifecycle.test.ts`, `nextTask()` from [`../../wait.ts`](../../wait.ts) in `settings.test.ts`) before asserting its effect.
