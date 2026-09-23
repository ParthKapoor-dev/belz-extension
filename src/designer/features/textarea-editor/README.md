# `src/designer/features/textarea-editor/`

Two hover buttons on every textarea, **Open** (⤢) and **Copy** (⧉), and the full-screen CodeMirror editor that Open launches. On AD pages the editor also completes, explains and lints `#{variable}` references. Runs in the content script on AD and PD pages. Switched by the `textareaEditor` setting.

This folder is performance-critical. Read "Textarea overlay", "`#{variable}` intellisense" and "Content-script module graph" in [AGENTS.md](../../../../AGENTS.md) before changing it.

## Contents

| File | What it does | Loaded |
|---|---|---|
| [`index.ts`](index.ts) | `TextareaEditor`, the `Feature`: the hover overlay, and the lazy `import('./modal')` | with the page |
| [`scope.ts`](scope.ts) | Types only: `ScopeVariable`, `VariableScope`, `ScopeProvider` | types, no code |
| [`modal.ts`](modal.ts) | `TextareaEditorModal` and the `textareaEditorModal` singleton: CodeMirror, language modes, header controls, save | on first Open |
| [`language.ts`](language.ts) | `detectLanguage()` and `LANGUAGE_OPTIONS`: picks SQL, SpEL, JavaScript, JSON, Java, Python or plain (pure) | on first Open |
| [`references.ts`](references.ts) | Finds `#{ … }` expressions, lints them, looks up a name at a position, builds labels and the footer status (pure) | on first Open |
| [`variables.ts`](variables.ts) | CodeMirror wiring for `#{variables}`: `variableCompletionSource()` and `variableExtensions()` (hover, lint, theme) | on first Open |

## How it works

**Overlay.** `TextareaEditor` owns one `HoverOverlay` (`ui/hover-overlay.ts`) with the id `ns('TextareaControls')`. `resolveTextarea()` accepts any textarea, including read-only and disabled ones, which it finds with `textareaUnderPointer()` because a disabled element gets no pointer events. `sizeForTextarea()` shrinks the buttons for boxes under 36 px high. There is one controls element for the whole page, no per-textarea DOM, and no `pageObserver` subscription.

**Open.**

1. `openEditorFor()` loads `./modal` once (`loadModal()`). A failed load is forgotten so the next click retries.
2. `scopeFor()` calls the `ScopeProvider`, if one was passed and `textareaVariableIntellisense` is on. Errors fall back to no scope.
3. `textareaEditorModal.open(textarea, scope)` builds the modal on first use, shows the source's label (with "(read only)" when it is read-only or disabled), and creates an `EditorView` with the text.

**Editor.** The language is detected on every open and again as the text changes, until the user picks one in the header for this session. It is not a setting. Wrap and font size come from `settings` and are written back when changed in the header. Keys while open (capture phase): Escape closes, Ctrl/Cmd+S saves, Ctrl/Cmd+F opens search. **Save** writes the text into the source textarea and fires `input` and `change`. For a read-only source Save is disabled and Ctrl+S only shows a toast.

**Variables** (only when a scope was passed):

- Completion is offered after `#{` and on bare names inside an open `#{ …`. Only in-scope variables are listed. After `#{name.` it offers `element`. The source is placed first in each mode's completion list.
- Hover over a known name shows where it comes from.
- Lint warns on an unclosed `#{`, an unknown name (only when the scan found any variables), and the output of the current or a later step. Only simple `#{name}` / `#{name.path}` forms are checked.
- The footer shows `scopeStatus()`, for example `Step 3.4 · 12 variables in scope`.

## How it connects

- **Used by:** `ad-content.ts` (with `scanScope` from [`../ad-scope/`](../ad-scope/) as the `ScopeProvider`) and `pd-content.ts` (without one).
- **Depends on:** `ui/hover-overlay.ts`, `ui/modal-lock.ts`, `ui/toast.ts`, `ui/modal.ts`, `ui/styles.ts`, `ui/theme.ts`, `utils/`, `core/settings.ts`, `settings/modal.ts` (the editor's ⚙ button), `config/settings.ts`, `config/namespace.ts`, and the `@codemirror/*` packages.

## Conventions

- **Keep `modal.ts` lazy.** Reach it only through `import('./modal')`. A static import from page-load code puts CodeMirror (~600 KB) back into every page load; `tests/build/bundle.test.ts` fails if that happens.
- **One graph.** The editor chunk shares `settings`, `modalLock`, `toast` and `settingsModal` with the page bundle through shared chunks. Never build it separately (see [AGENTS.md](../../../../AGENTS.md)).
- **No per-textarea DOM and no rescans.** Use delegation through `HoverOverlay`.
- **The editor never reads the page for variables.** It only gets a `VariableScope`. `scope.ts` stays types-only so the PD bundle carries no scanner.
- Keep pure logic in `language.ts` and `references.ts`, so it can be tested without loading CodeMirror.
- `TextareaEditor.stop()` disposes the modal only if it was ever loaded.

## Testing

- [`tests/designer/features/language.test.ts`](../../../../tests/designer/features/language.test.ts): `detectLanguage()`.
- [`tests/designer/features/variables.test.ts`](../../../../tests/designer/features/variables.test.ts): completion, expression finding, lint, hover lookup and footer status.
- [`tests/designer/ui/hover-overlay.test.ts`](../../../../tests/designer/ui/hover-overlay.test.ts): the overlay.
- [`tests/build/bundle.test.ts`](../../../../tests/build/bundle.test.ts): the editor stays out of the page-load bundle.
- [`tests/e2e/`](../../../../tests/e2e/): in real browsers, the overlay (also on a disabled textarea), lazy loading, SQL detection, the footer status, and the shared modal lock.

How to run them is in the Development section of the [root README](../../../../README.md).

## Adding or changing things

- **A new language mode:** add it to `LanguageMode` and `LANGUAGE_OPTIONS` and teach `detectLanguage()` in `language.ts`, then add its extension to `getLanguageExtensionForMode()` and its completion to `getAutocompleteExtensionsForMode()` in `modal.ts`.
- **Overlay changes** (`index.ts` or `ui/hover-overlay.ts`): re-run the node-visit benchmark described in [AGENTS.md](../../../../AGENTS.md) before and after.
