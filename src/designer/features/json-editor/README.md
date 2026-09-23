# `src/designer/features/json-editor/`

Edit all of an Automation Designer method's test inputs as one JSON object. A **JSON** button next to the Inputs heading (or Shift+J) opens a modal that shows the current test values as JSON; **Sync** writes an edited object back into each input with the right type. AD pages only. Switched by the `jsonEditor` setting.

This is the most fragile part of the extension: it reads and drives AD's own widgets. See "JSON sync engine" and "Known risks" in [AGENTS.md](../../../../AGENTS.md).

## Contents

| File | What it does |
|---|---|
| [`index.ts`](index.ts) | `JsonEditor`, the `Feature`: injects the JSON button and keeps it on the page |
| [`injector.ts`](injector.ts) | `createJSONButton()`, `findInputsSection()`, `injectJSONButton()` |
| [`modal.ts`](modal.ts) | `JsonEditorModal` and the `jsonEditorModal` singleton: load, edit, sync |
| [`extractor.ts`](extractor.ts) | `extractAllInputs()`: reads every input (key, name, type, value element, mandatory, current value) from the page |
| [`types.ts`](types.ts) | `DataType`, `ExtractedInput`, `normalizeDataType()`, `generateInputJSON()` (page values to JSON) |
| [`values.ts`](values.ts) | `normalizeValueForType()`, `parseDateValue()`: JSON value to the text an input holds (pure, no DOM) |
| [`sync.ts`](sync.ts) | `syncJSONToInputs()` and `populateTestValue()`: write values into the page and check them |

## How it works

**Button.** `JsonEditor.start()` tries `injectJSONButton()` after `TIMINGS.jsonButtonFirstTry` and on every `pageObserver` change, because AD renders the Inputs heading late and re-renders it. `findInputsSection()` looks for a text node like `Inputs` or `2 Inputs`, then falls back to `AD_INPUTS.sectionCandidates`. The button is marked `EXTENSION_OWNED_ATTR`. To hold it, the heading gets an inline flex layout; `injectJSONButton()` records the heading's previous inline values, and `JsonEditor.stop()` puts them back (`restoreHeadings()`) along with removing the button.

**Load (page to JSON).** `jsonEditorModal.open()` calls `load()`, which runs `extractAllInputs()`:

1. `findAllInputKeys()` reads keys from `INPUT_LIST_<key>` ids, then numbered ids, then (published methods) the `.fieldCode` spans.
2. For each key: the grid row (`findInputContainer`), the declared type from the row's type cell (`extractDataType`), the element that holds the test value (`findTestValueElement`, inside the test-case row), the name and whether it is mandatory.

`generateInputJSON()` turns the current values into JSON by type (Json/Array/Map/StructuredData parsed, Boolean and numbers converted, others kept as strings). An empty value becomes `null`.

**Sync (JSON to page).** `syncJSONToInputs()` parses the text, re-extracts the inputs, and writes each key with `populateTestValue()`. Date and DateTime keys go last, because their pop-ups can disturb other fields.

- `normalizeValueForType()` validates the value first, so a bad value is reported without touching the page.
- Text-like fields: the prototype's `value` setter, then `input`/`change`/`blur` events, then a read-back.
- Boolean `exp-select`: open the dropdown and click the matching option.
- Date `exp-date-picker`: open the calendar, page month by month, click the day.
- DateTime: the date as above, then the time picker's hour, minute and AM/PM.
- File inputs are skipped with a warning.

The result is a `SyncResult`: `success`, `message`, `errors`, `warnings`, `filledCount`, `skippedMissingKeys`, `failedKeys`. The modal closes on full success and stays open to show warnings.

## How it connects

- **Used by:** `ad-content.ts` (`JsonEditor`, and `jsonEditorModal.open` passed to `KeyboardShortcuts` for Shift+J), and `curl-autofill/` (`extractAllInputs`, `syncJSONToInputs`).
- **Depends on:** `AD_INPUTS` and `AD_WIDGETS` in `config/selectors.ts`, the widget waits in `config/timings.ts`, `core/observer.ts`, `ui/modal-lock.ts`, `ui/toast.ts`, `ui/modal.ts`, `ui/styles.ts`, `ui/theme.ts`, `utils/dom.ts` (`firstMatch`).

## Conventions

- AD-only. Only `ad-content.ts` imports it. `tests/build/bundle.test.ts` fails if its "Edit Input JSON" title reaches the PD bundle.
- `modal.ts` holds page-wide state and has a `belz-singleton` marker. `JsonEditor.stop()` calls `jsonEditorModal.dispose()`.
- Messages built from page text use `textContent`, never HTML.
- Keep value rules in `values.ts` (pure) and DOM work in `sync.ts`.

## Testing

- [`tests/designer/features/json-editor.test.ts`](../../../../tests/designer/features/json-editor.test.ts): `extractAllInputs()` and `syncJSONToInputs()` against the fixture in [`tests/fixtures/ad-inputs.ts`](../../../../tests/fixtures/ad-inputs.ts) (text, number, boolean, missing keys, file inputs, invalid values).
- [`tests/designer/features/json-button.test.ts`](../../../../tests/designer/features/json-button.test.ts): `injectJSONButton()` and `restoreHeadings()`.
- [`tests/designer/features/json-values.test.ts`](../../../../tests/designer/features/json-values.test.ts): `normalizeDataType()`, `normalizeValueForType()`, `parseDateValue()`, `generateInputJSON()`.

The calendar and time-picker paths are not unit-tested; check them by hand on a real AD page after any change to `sync.ts`. How to run the tests is in the Development section of the [root README](../../../../README.md).

## Adding or changing things

- **AD changed its input markup:** update `AD_INPUTS` / `AD_WIDGETS` in `config/selectors.ts` and the fixture in `tests/fixtures/ad-inputs.ts`.
- **A widget got flaky** (option not found, date not committed): look at the waits in `config/timings.ts` first.
- **A new data type:** add it to `DataType` and `TYPE_BY_LABEL` in `types.ts`, its value rule in `values.ts`, its selectors in `AD_INPUTS.testValue`, and a setter in `sync.ts` if it is a custom widget.
