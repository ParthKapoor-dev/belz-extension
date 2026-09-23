# `tests/designer/features/`

Unit tests for the designer features in [`src/designer/features/`](../../../src/designer/features/). Most test a feature's pure or DOM-reading logic directly, not the `Feature` class wired by `bootstrap()`.

## Contents

| File | Source under test | What it covers |
|---|---|---|
| [`ad-scope.test.ts`](ad-scope.test.ts) | [`ad-scope/scan.ts`](../../../src/designer/features/ad-scope/scan.ts) | `scanScope()` on the [`ad-scope` fixture](../../fixtures/ad-scope.ts): which inputs, internal variables and step outputs are in scope from each step and from outside any step; a declared variable written by a step is listed once; a re-scan sees renamed and added outputs; an empty page has none. Also `fieldCodeName()` (both "Field Code" spellings, whitespace, rejects) and `stepIndexOf()`. |
| [`json-button.test.ts`](json-button.test.ts) | [`json-editor/injector.ts`](../../../src/designer/features/json-editor/injector.ts) | `injectJSONButton()` marks the button with `EXTENSION_OWNED_ATTR`, restyles the Inputs heading and records it; a second pass adds nothing; `restoreHeadings()` puts the heading's inline style back (what `JsonEditor.stop()` does), and forgets headings the app re-rendered away. |
| [`json-editor.test.ts`](json-editor.test.ts) | [`json-editor/extractor.ts`](../../../src/designer/features/json-editor/extractor.ts), [`json-editor/sync.ts`](../../../src/designer/features/json-editor/sync.ts) | `extractAllInputs()` on the [`ad-inputs` fixture](../../fixtures/ad-inputs.ts): key, name (falls back to key), type, mandatory, current value and control per input. `syncJSONToInputs()`: fills text, integer, boolean and JSON inputs; fires `input` and `change`; warns on keys missing from the page and on file inputs; reports invalid values without writing them; rejects invalid JSON, arrays and `null`; explains a page with no inputs. |
| [`json-values.test.ts`](json-values.test.ts) | [`json-editor/values.ts`](../../../src/designer/features/json-editor/values.ts), [`json-editor/types.ts`](../../../src/designer/features/json-editor/types.ts) | `normalizeDataType()` (including the AD UI's `interger` typo and a non-breaking space), `normalizeValueForType()` per type, `parseDateValue()` formats, and `generateInputJSON()` turning page values back into typed JSON. |
| [`language.test.ts`](language.test.ts) | [`textarea-editor/language.ts`](../../../src/designer/features/textarea-editor/language.ts) | `detectLanguage()` on plain text, JSON, SQL (including SQL containing `#{...}`), SpEL, Java, Python and JavaScript; every detected mode is in `LANGUAGE_OPTIONS`. |
| [`page-helpers.test.ts`](page-helpers.test.ts) | [`curl-autofill/index.ts`](../../../src/designer/features/curl-autofill/index.ts), [`utils/dom.ts`](../../../src/designer/utils/dom.ts) | `decodeAutofillParam()` with the `AUTOFILL_PARAM` query parameter; `extractMethodName()`, `extractServiceCategory()` and `extractPageName()` against minimal markup. |
| [`shortcuts.test.ts`](shortcuts.test.ts) | [`keyboard/shortcuts.ts`](../../../src/designer/features/keyboard/shortcuts.ts) | `KeyboardShortcuts`: `Ctrl+Shift+Enter` clicks Run Test; does nothing while `modalLock` is held or the button is disabled; commits a focused field first and clicks after a delay; `stop()` removes it. `Esc` `Esc` leaves a focused field. |
| [`variables.test.ts`](variables.test.ts) | [`textarea-editor/variables.ts`](../../../src/designer/features/textarea-editor/variables.ts), [`textarea-editor/references.ts`](../../../src/designer/features/textarea-editor/references.ts) | `#{variable}` intellisense against a fixed `VariableScope`: completion (after `#{`, bare names inside SpEL, `element` after `name.`), `findExpressions()` and `isInsideExpression()`, `lintReferences()`, `referenceAt()` for hover, `describeVariable()` and `scopeStatus()`. |

## How it works

- `variables.test.ts` runs the real CodeMirror completion source: it builds an `EditorState` and a `CompletionContext` at the `|` in a test string, and reduces the result to plain labels and offsets.
- `shortcuts.test.ts` starts one `KeyboardShortcuts` before each test and stops it after, on a body with an `<exp-button id="runTest">` and an input.
- Fixture-based tests re-render the page in each test or `beforeEach`, since all files share one document.

## Conventions

- Extracted inputs hold live DOM nodes (`testValueElement`, `container`). `json-editor.test.ts` maps them to a plain `summary()` before any assertion. Do the same for any new test on DOM-holding results.
- A test that locks `modalLock` must unlock it before it ends.

## Adding or changing things

**Testing a new feature:** add `<feature>.test.ts` here. Keep the feature's logic in importable modules (as `json-editor/values.ts` and `textarea-editor/language.ts` are), and test those rather than the class that wires listeners. If the feature reads AD page markup, add or extend a fixture in [`../../fixtures/`](../../fixtures/).
