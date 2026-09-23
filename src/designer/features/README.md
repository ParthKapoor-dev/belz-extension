# `src/designer/features/`

One folder per designer feature. Each runs in the content script on AD pages, PD pages, or both. The entries in [`../`](../) decide which features a page gets.

## Contents

| Folder | What it does | Setting | Pages |
|---|---|---|---|
| [`title-updater/`](title-updater/) | `TitleUpdater`: tab title `AD: <method>` / `PD: <page>` | `titleUpdater` | AD, PD |
| [`keyboard/`](keyboard/) | `KeyboardShortcuts`: Esc Esc everywhere; Ctrl+Shift+Enter, Shift+L, Shift+J on AD | `runTestShortcut` | AD, PD |
| [`run-test/`](run-test/) | `runTestAction`: finds and clicks AD's Run Test button (passed to `KeyboardShortcuts` by `ad-content.ts`) | none | AD |
| [`json-editor/`](json-editor/) | `JsonEditor`: JSON button and modal to edit every test input as one JSON object | `jsonEditor` | AD |
| [`output-copy/`](output-copy/) | `OutputCopy`: hover copy button on output containers | `outputCopy` | AD, PD |
| [`textarea-editor/`](textarea-editor/) | `TextareaEditor`: hover Open/Copy buttons on textareas, and the lazy CodeMirror editor with `#{variable}` intellisense | `textareaEditor` | AD, PD |
| [`ad-scope/`](ad-scope/) | `scanScope()`: reads the `#{variables}` in scope from the AD page, for the editor | `textareaVariableIntellisense` (checked by `TextareaEditor`) | AD |
| [`curl-autofill/`](curl-autofill/) | `startCurlAutofillFeature()`: fills the inputs with the request body the AD Network panel handed over ("Open in draft") | none, always on | AD |
| [`settings/`](settings/) | `SettingsLauncher` (⚙ button, Ctrl+, / Alt+, and the Alt+Shift+S browser command) and the in-page Settings modal | none, always on | AD, PD |

## How it works

Toggleable features are classes implementing `Feature` from [`../core/feature.ts`](../core/feature.ts). The entry passes them to `bootstrap()`, which starts and stops each as its setting changes. `SettingsLauncher` is started by `bootstrap()` itself. `startCurlAutofillFeature()` is called once by `ad-content.ts`. `run-test/` and `ad-scope/` are plain functions that other code calls.

Features share state only through the page-wide singletons: `settings`, `pageObserver`, `modalLock`, `toast`, and the modals `jsonEditorModal`, `settingsModal` and `textareaEditorModal`.

## Conventions

- `start()` and `stop()` are each safe to call twice, and `stop()` undoes everything `start()` did: listeners, timers, `pageObserver` subscriptions, injected DOM. A feature that owns a modal calls the modal's `dispose()`.
- Code that only AD needs is passed in as a constructor argument from `ad-content.ts` (`KeyboardShortcuts` takes its `ShortcutActions`, `TextareaEditor` takes a `ScopeProvider`), so it is not bundled into PD pages.
- Only the topmost modal answers keys: modals take `modalLock` with themselves as owner and check `modalLock.isTopmost(this)` (see [`../ui/`](../ui/)).
- Selectors for the page's markup go in `config/selectors.ts`, waits tuned against the page in `config/timings.ts`, and the extension's own ids come from `ns()`.

See "Feature flow" in [AGENTS.md](../../../AGENTS.md).

## Testing

Tests are in [`tests/designer/features/`](../../../tests/designer/features/). How to run them is in the Development section of the [root README](../../../README.md).

## Adding or changing things

Adding a toggleable feature:

1. Add a toggle to `SETTINGS` in `config/settings.ts` (section `features`). The settings modal shows it automatically.
2. Create `features/<name>/index.ts` with a class implementing `Feature`.
3. Construct it in `ad-content.ts`, `pd-content.ts`, or both, under the new setting key in the `bootstrap()` call.
4. Add a test under `tests/designer/features/`, and update the feature list in [AGENTS.md](../../../AGENTS.md).
