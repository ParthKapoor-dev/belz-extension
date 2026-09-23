# `src/designer/features/ad-scope/`

Reads which `#{variables}` an Automation Designer method has, and which of them the step being edited can use, straight from the live page. The IDE uses the result for completion, hover and lint. AD pages only.

## Contents

| File | What it does |
|---|---|
| [`scan.ts`](scan.ts) | `scanScope(root, textarea)`, plus its helpers `stepIndexOf()` and `fieldCodeName()` |

## How it works

`scanScope()` is pure and keeps no state. It runs two `querySelectorAll` calls:

1. **Inputs and internal variables:** every `AD_SCOPE.declaredFieldCodes` element. The name comes from its `Field Code: #{name}` text (`AD_SCOPE.fieldCodeText`). Inside `AD_SCOPE.internalList` it is a `variable`, otherwise an `input`. These are always in scope.
2. **Step outputs:** every `AD_SCOPE.stepOutputFieldCodes` element. Its step index comes from the id of the enclosing `AD_SCOPE.step` element (`step3_<index>`, 0-based). An output is in scope only if its step comes before the edited textarea's step. Outside any step, everything is in scope.

Each name is listed once. A declared variable wins over an output with the same name, and an output made by several steps keeps the earliest. The result is a `VariableScope` (`{ step, variables }`), whose types live in [`../ide/scope.ts`](../ide/scope.ts).

It reads the page, not the chain API. So unsaved draft edits count, and no auth is needed.

## How it connects

- **Used by:** `ad-content.ts`, which passes `(textarea) => scanScope(document, textarea)` to `Ide` as its `ScopeProvider`. `Ide.scopeFor()` calls it once per IDE open, and only when `ideIntellisense` is on.
- **Depends on:** `AD_SCOPE` in `config/selectors.ts`, `shared/logger.ts`, and the types in `ide/scope.ts`.

## Conventions

- Keep it AD-only: only `ad-content.ts` may import it. `tests/build/bundle.test.ts` fails if its `"ad-scope"` logger scope reaches the PD bundle.
- Run once per open. No caching across opens, no per-keystroke calls, no `MutationObserver`.
- All selectors and the field-code regex live in `AD_SCOPE`. The DOM contract is described in the `#{variable}` intellisense section of [AGENTS.md](../../../../AGENTS.md).

## Testing

[`tests/designer/features/ad-scope.test.ts`](../../../../tests/designer/features/ad-scope.test.ts), with the page fixture in [`tests/fixtures/ad-scope.ts`](../../../../tests/fixtures/ad-scope.ts), covers scoping and field-code parsing. The e2e run checks that the scanner ran (footer status). How to run them is in the Development section of the [root README](../../../../README.md).

## Adding or changing things

If AD changes its markup, update `AD_SCOPE` in `config/selectors.ts` and the fixture in `tests/fixtures/ad-scope.ts` together, then check on a live AD page.
