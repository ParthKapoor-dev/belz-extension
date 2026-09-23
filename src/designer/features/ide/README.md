# `src/designer/features/ide/`

Two hover buttons on every textarea, **Open** (⤢) and **Copy** (⧉), and the full-screen CodeMirror IDE that Open launches. On AD pages the IDE also completes, explains and lints `#{variable}` references. Runs in the content script on AD and PD pages. Switched by the `ide` setting.

This folder is performance-critical. Read "Textarea overlay (opens the IDE)", "IDE `#{variable}` intellisense" and "Content-script module graph" in [AGENTS.md](../../../../AGENTS.md) before changing it.

## Contents

| File | What it does | Loaded |
|---|---|---|
| [`index.ts`](index.ts) | `Ide`, the `Feature`: the hover overlay, and the lazy `import('./modal')` | with the page |
| [`scope.ts`](scope.ts) | Types only: `ScopeVariable`, `VariableScope`, `ScopeProvider` | types, no code |
| [`modal.ts`](modal.ts) | `IdeModal` and the `ideModal` singleton: CodeMirror, language modes, header controls, save | on first Open |
| [`language.ts`](language.ts) | `detectLanguage()` and `LANGUAGE_OPTIONS`: picks SQL, SpEL, JavaScript, JSON, Java, Python or plain (pure) | on first Open |
| [`references.ts`](references.ts) | Finds `#{ … }` expressions, lints them, looks up a name at a position, builds labels and the footer status (pure) | on first Open |
| [`variables.ts`](variables.ts) | CodeMirror wiring for `#{variables}`: `variableCompletionSource()` and `variableExtensions()` (hover, lint, theme) | on first Open |

## How it works

**Overlay.** `Ide` owns one `HoverOverlay` (`ui/hover-overlay.ts`) with the id `ns('TextareaControls')`. `resolveTextarea()` accepts any textarea, including read-only and disabled ones, which it finds with `textareaUnderPointer()` because a disabled element gets no pointer events. `sizeForTextarea()` shrinks the buttons for boxes under 36 px high. There is one controls element for the whole page, no per-textarea DOM, and no `pageObserver` subscription.

**Open.**

1. `openIdeFor()` loads `./modal` once (`loadModal()`). A failed load is forgotten so the next click retries.
2. `scopeFor()` calls the `ScopeProvider`, if one was passed and `ideIntellisense` is on. Errors fall back to no scope.
3. `ideModal.open(textarea, scope)` builds the modal on first use, shows the source's label (with "(read only)" when it is read-only or disabled), and creates an `EditorView` with the text.

**IDE.** The language is detected on every open and again as the text changes, until the user picks one in the header's language dropdown, which overrides it for this open only. It is not a setting. The wrap and font-size dropdowns in the header read `settings` and write back to it, so they change the global IDE Wrap and IDE Font Size settings for every IDE on every site. The header's ⚙ button opens the Settings modal over the IDE; **Copy** copies the IDE's text.

Keys while open are handled by one `keydown` listener on `window` in the capture phase, and only while the IDE is the topmost modal (`modalLock.isTopmost(this)`), so with the Settings modal over it they belong to that modal. It runs before every listener on the document and below, and before window-capture listeners added after the IDE first opened. A key it handles is consumed (`preventDefault()` and `stopImmediatePropagation()`), so neither the page's own shortcuts nor the browser's Save page / Find act on it:

- Ctrl/Cmd+S saves (and closes); Ctrl/Cmd+F opens search.
- Escape first leaves CodeMirror's own popups to CodeMirror: while the completion list (`completionStatus`) or the search panel (`searchPanelOpen`) is open, the modal does not act, and CodeMirror's Escape closes the popup.
- Otherwise Escape closes the IDE, unless there are unsaved changes (`hasUnsavedChanges`: the text differs from what was opened). Then the first Escape only shows `DISCARD_PROMPT` in the footer, and a second Escape within `DISCARD_WINDOW_MS` (3 s) discards the changes and closes. Typing after the prompt takes it back. This never uses a browser dialog.

Closing, in one place: **Save** (or Ctrl/Cmd+S) writes the text into the source textarea, fires `input` and `change`, and closes; for a read-only source Save is disabled and Ctrl+S only shows a toast. **Cancel** and **×** close without saving and without asking: they are explicit. **Escape** and a **click on the backdrop** close at once when nothing changed; with unsaved changes they ask first (`closeOrAskFirst()`), and a second press or click (either one) within the window discards.

**Variables** (only when a scope was passed):

- Completion is offered after `#{` and on bare names inside an open `#{ …`. Only in-scope variables are listed. After `#{name.` it offers `element`. The source is placed first in each mode's completion list.
- Hover over a known name shows where it comes from.
- Lint warns on an unclosed `#{`, an unknown name (only when the scan found any variables), and the output of the current or a later step. Only simple `#{name}` / `#{name.path}` forms are checked.
- The footer shows `scopeStatus()`, for example `Step 3.4 · 12 variables in scope`.

## How it connects

- **Used by:** `ad-content.ts` (with `scanScope` from [`../ad-scope/`](../ad-scope/) as the `ScopeProvider`) and `pd-content.ts` (without one).
- **Depends on:** `ui/hover-overlay.ts`, `ui/modal-lock.ts`, `ui/toast.ts`, `ui/modal.ts`, `ui/styles.ts`, `ui/theme.ts`, `utils/`, `core/settings.ts`, `settings/modal.ts` (the IDE's ⚙ button), `config/settings.ts`, `config/namespace.ts`, and the `@codemirror/*` packages.

## Conventions

- **Keep `modal.ts` lazy.** Reach it only through `import('./modal')`. A static import from page-load code puts CodeMirror (~600 KB) back into every page load; `tests/build/bundle.test.ts` fails if that happens.
- **One graph.** The IDE chunk shares `settings`, `modalLock`, `toast` and `settingsModal` with the page bundle through shared chunks. Never build it separately (see [AGENTS.md](../../../../AGENTS.md)).
- **No per-textarea DOM and no rescans.** Use delegation through `HoverOverlay`.
- **The IDE never reads the page for variables.** It only gets a `VariableScope`. `scope.ts` stays types-only so the PD bundle carries no scanner.
- Keep pure logic in `language.ts` and `references.ts`, so it can be tested without loading CodeMirror.
- `Ide.stop()` disposes the modal only if it was ever loaded.

## Testing

- [`tests/designer/features/language.test.ts`](../../../../tests/designer/features/language.test.ts): `detectLanguage()`.
- [`tests/designer/features/variables.test.ts`](../../../../tests/designer/features/variables.test.ts): completion, expression finding, lint, hover lookup and footer status.
- [`tests/designer/ui/hover-overlay.test.ts`](../../../../tests/designer/ui/hover-overlay.test.ts): the overlay.
- [`tests/designer/features/modal-escape.test.ts`](../../../../tests/designer/features/modal-escape.test.ts): Escape and a click on the backdrop (unchanged text, the discard prompt, the search panel, the Settings modal on top), Ctrl+S under the Settings modal, and that the keys the IDE handles never reach the page's own listeners.
- [`tests/build/bundle.test.ts`](../../../../tests/build/bundle.test.ts): the IDE stays out of the page-load bundle.
- [`tests/e2e/`](../../../../tests/e2e/): in real browsers, the overlay (also on a disabled textarea), lazy loading, SQL detection, the footer status, and the shared modal lock.

How to run them is in the Development section of the [root README](../../../../README.md).

## Adding or changing things

- **A new language mode:** add it to `LanguageMode` and `LANGUAGE_OPTIONS` and teach `detectLanguage()` in `language.ts`, then add its extension to `getLanguageExtensionForMode()` and its completion to `getAutocompleteExtensionsForMode()` in `modal.ts`.
- **Overlay changes** (`index.ts` or `ui/hover-overlay.ts`): keep one controls element and no per-textarea DOM (see [AGENTS.md](../../../../AGENTS.md)); run `tests/designer/ui/hover-overlay.test.ts` and the end-to-end suite, which checks the overlay on a normal and a disabled textarea in real browsers.
