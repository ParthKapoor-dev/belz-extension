# `tests/fixtures/`

Minimal copies of Automation Designer page markup for tests that read the page's DOM. Each fixture holds only the structure the code under test relies on, and renders it into `document.body`.

## Contents

| File | What it does | Used by |
|---|---|---|
| [`ad-inputs.ts`](ad-inputs.ts) | Renders an AD "Inputs" step from a list of `InputSpec` (`key`, `type`, `name`, `mandatory`, `value`). Exports `renderInputs()` and `inputRow()`. | [`designer/features/json-editor.test.ts`](../designer/features/json-editor.test.ts) |
| [`ad-scope.ts`](ad-scope.ts) | Renders an AD method page for the `#{variable}` scanner: inputs and internal variables in `#step2`, then one `exp-sd-step-three` per step with its outputs and a textarea (`ta0`, `ta1`, ...), plus textareas outside the steps (`taInputs`, `taOutputs`). Exports `renderAdScope()` and `renderStepOutput()`. | [`designer/features/ad-scope.test.ts`](../designer/features/ad-scope.test.ts) |

## How it works

- **`ad-inputs.ts`** writes one grid row per input with the `INPUT_LIST_<key>` id, type, name and mandatory cells, and a test-value row holding the control: an `exp-select` for `Boolean`, `<input type="number">` for `Number`/`Integer`, `<input type="file">` for `File`, a `<textarea>` otherwise. It also wires the `exp-select` so a click opens its option list and clicking an option commits it to the match text, as the real widget does.
- **`ad-scope.ts`** writes field codes in the two spellings the live page uses: `Field Code: #{name}` in the Inputs step and `Field Code : #{name}` for step outputs.

## Conventions

- Keep fixtures in step with the selectors in [`src/config/selectors.ts`](../../src/config/selectors.ts) (`AD_INPUTS`, `AD_SCOPE`). If the real page changes and the selectors change, update the fixture to the new markup.
- Add only the markup the code reads. A fixture that copies the whole page is harder to keep correct.
- Fixtures replace `document.body`. Call them at the start of each test or in `beforeEach`.
