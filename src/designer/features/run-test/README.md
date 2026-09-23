# `src/designer/features/run-test/`

Finds Automation Designer's Run Test button and clicks it. It is the action behind the Ctrl+Shift+Enter shortcut. It is not a feature on its own and has no setting.

## Contents

| File | What it does |
|---|---|
| [`index.ts`](index.ts) | `findRunTestButton()` and `triggerRunTest()` |

## How it works

- `findRunTestButton()` tries each selector in `AD.runTestButtons` (`config/selectors.ts`). For each match it skips hidden hosts (`offsetParent === null`) and returns the first inner `<button>` that is not disabled.
- `triggerRunTest()` clicks that button and shows the toast "Run Test triggered". If no button is found, it does nothing.

## How it connects

- **Used by:** `KeyboardShortcuts` in [`../keyboard/`](../keyboard/).
- **Depends on:** `AD.runTestButtons` in `config/selectors.ts`, `ui/toast.ts`.

## Testing

Covered through the shortcut in [`tests/designer/features/shortcuts.test.ts`](../../../../tests/designer/features/shortcuts.test.ts), including the disabled-button case. How to run it is in the Development section of the [root README](../../../../README.md).
