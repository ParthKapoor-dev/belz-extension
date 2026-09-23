# `src/designer/features/run-test/`

Finds Automation Designer's Run Test button and clicks it. It is the action behind the Ctrl+Shift+Enter shortcut on AD pages. It is not a feature on its own and has no setting.

## Contents

| File | What it does |
|---|---|
| [`index.ts`](index.ts) | `findRunTestButton()`, `triggerRunTest()` and `runTestAction` |

## How it works

- `findRunTestButton()` tries each selector in `AD.runTestButtons` (`config/selectors.ts`). For each match it skips hidden hosts (`offsetParent === null`) and returns the first inner `<button>` that is not disabled.
- `triggerRunTest()` clicks that button and shows the toast "Run Test triggered". If no button is found, it does nothing.
- `runTestAction` is the `runTest` entry of `ShortcutActions` (see [`../keyboard/`](../keyboard/)): `available()` is true when `findRunTestButton()` finds a button, and `run()` is `triggerRunTest()`.

## How it connects

- **Used by:** `ad-content.ts`, which passes `runTestAction` to `KeyboardShortcuts`. Page Designer has no Run Test button, so `pd-content.ts` does not import this.
- **Depends on:** `AD.runTestButtons` in `config/selectors.ts`, `ui/toast.ts`.

## Testing

Covered through the shortcut in [`tests/designer/features/shortcuts.test.ts`](../../../../tests/designer/features/shortcuts.test.ts), including the disabled and missing button cases. How to run it is in the Development section of the [root README](../../../../README.md).
