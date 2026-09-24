# `src/designer/features/ide/`

Two hover buttons on every textarea, **Open** (⤢) and **Copy** (⧉), and the full-screen CodeMirror IDE that Open launches. On AD pages the IDE also completes, explains and lints `#{variable}` references. Runs in the content script on AD and PD pages. Switched by the `ide` setting.

This folder is performance-critical. Read "Textarea overlay (opens the IDE)", "IDE `#{variable}` intellisense" and "Content-script module graph" in [AGENTS.md](../../../../AGENTS.md) before changing it.

## Contents

| File | What it does | Loaded |
|---|---|---|
| [`index.ts`](index.ts) | `Ide`, the `Feature`: the hover overlay, and the lazy `import('./modal')` | with the page |
| [`scope.ts`](scope.ts) | Types only: `ScopeVariable`, `VariableScope`, `ScopeProvider` | types, no code |
| [`modal.ts`](modal.ts) | `IdeModal` and the `ideModal` singleton: CodeMirror, language modes, header controls, save | on first Open |
| [`language.ts`](language.ts) | `detectLanguage()` and `LANGUAGE_OPTIONS`: picks SQL, SpEL, JavaScript, JSON, Java, Python or plain; `isFormattable()` (pure) | on first Open |
| [`format.ts`](format.ts) | `formatCode()`: SQL (sql-formatter, PostgreSQL dialect, `SQL_FORMAT_OPTIONS`) and JSON, keeping `#{ … }` and `:name` intact; `mapPosition()` for the cursor (pure) | on first Format |
| [`footer.ts`](footer.ts) | `FooterStatus`: the footer's status line, the one owner of the open's own text, Format messages, the Vim mode line and the discard prompt (`DISCARD_PROMPT`, `FOOTER_TIMES`) | on first Open |
| [`vim.ts`](vim.ts) | Vim mode: `vimExtension(host)` (`@replit/codemirror-vim`, drawn selection, block-cursor colours, `VimBridge`), the IDE's ex commands, the clipboard sync (`copiesToClipboard()`), `vimKeyState()` for Esc and `modeLine()` for the footer | on the first Open, or setting change, with IDE Vim Mode on |
| [`references.ts`](references.ts) | Finds `#{ … }` expressions, lints them, looks up a name at a position, builds labels and the footer status (pure) | on first Open |
| [`variables.ts`](variables.ts) | CodeMirror wiring for `#{variables}`: `variableCompletionSource()` and `variableExtensions()` (hover, lint, theme) | on first Open |

## How it works

**Overlay.** `Ide` owns one `HoverOverlay` (`ui/hover-overlay.ts`) with the id `ns('TextareaControls')`. `resolveTextarea()` accepts any textarea, including read-only and disabled ones, which it finds with `textareaUnderPointer()` because a disabled element gets no pointer events. `sizeForTextarea()` shrinks the buttons for boxes under 36 px high. There is one controls element for the whole page, no per-textarea DOM, and no `pageObserver` subscription.

**Open.**

1. `openIdeFor()` loads `./modal` once (`loadModal()`). A failed load is forgotten so the next click retries.
2. `scopeFor()` calls the `ScopeProvider`, if one was passed and `ideIntellisense` is on. Errors fall back to no scope.
3. `ideModal.open(textarea, scope)` builds the modal on first use, shows the source's label (with "(read only)" when it is read-only or disabled), and creates an `EditorView` with the text.

**IDE.** The language is detected on every open and again as the text changes, until the user picks one in the header's language dropdown, which overrides it for this open only. It is not a setting. The wrap and font-size dropdowns in the header read `settings` and write back to it, so they change the global IDE Wrap and IDE Font Size settings for every IDE on every site. The header's ⚙ button opens the Settings modal over the IDE; **Copy** copies the IDE's text.

**Format.** The header's **Format** button and `Shift+Alt+F` (matched on the physical key only, `event.code === 'KeyF'`, since Option changes the key's character on a Mac) call `IdeModal.format()`:

1. Only in SQL and JSON mode (`isFormattable()`). In any other mode the button is `aria-disabled` (still clickable, so a click can say why) and both it and the key only show `FORMAT_UNAVAILABLE` in the footer.
2. The first Format loads `./format` with `import()`; `format.ts` and sql-formatter are their own chunk, not part of the IDE chunk. A failed load is forgotten so the next Format retries. If the IDE was closed, reopened or switched mode meanwhile, nothing happens.
3. It formats the selection, or the whole text when nothing is selected, and applies the result as **one** transaction with `userEvent: 'format'`, so one Ctrl+Z restores the original. Already formatted text dispatches nothing. The cursor stays after the same non-whitespace character (`mapPosition()`); a formatted selection stays selected, and every formatted line after its first gets the indentation of the line the selection starts on (`FormatPlace.indent`), so it keeps its place in the text around it.
4. On an error the text is not touched; the footer shows the reason for `FOOTER_TIMES.messageMs` (4 s) and it is logged with `log.debug`. Errors name document lines (`FormatPlace.line`), also for a selection.

How `format.ts` keeps AD's syntax: **SQL**: each `#{ … }` (found with `findExpressions()`, so braces and quotes inside nest correctly) is swapped for an identifier token with a prefix the text does not contain, formatted by sql-formatter's PostgreSQL dialect, and swapped back; every token must come back exactly once, or the result is an error, never a guess. `:name` and `$1` are declared as parameters (`paramTypes`), which also keeps `::type` casts and the jsonb operators intact. Keywords are upper case, data types lower case (`dataTypeCase: 'lower'`) and names as written (`identifierCase: 'preserve'`). sql-formatter upper-cases a data type followed by `[` (`::text[]`) as a keyword whatever the option says, so `lowerArrayTypes()` lower-cases PostgreSQL's one-word data types before a `[` itself, outside strings, quoted names and comments (`ARRAY[…]` stays upper case). sql-formatter lays out almost any text, so before it runs the first word (past whitespace, parentheses, comments and placeholders) must start a SQL statement (`SQL_STATEMENT_WORDS`: `SELECT`, `WITH`, `INSERT`, `UPDATE`, …); anything else is "Doesn't look like SQL". An unclosed `#{` is an error, and so is anything sql-formatter throws, with the line it names mapped to the document's. **JSON**: the text is tokenised (strings, bare `#{ … }` placeholders, punctuation, literals), checked with `JSON.parse` with each bare placeholder standing in as `""`, and then re-laid out from its own tokens exactly as `JSON.stringify(value, null, 2)` would, so large numbers, number spellings, escapes and duplicate keys are kept. When that check fails, it is made once more with every balanced `#{ … }` inside a string taken as part of the string (so `"#{f("x")}"`, whose expression holds double quotes, formats); the first check's error is the one shown. Both keep the whitespace around the formatted text.

A **read-only** source can be formatted too: reading a published query is the main use. Nothing is written back (Save stays disabled), and a Format there is not an unsaved change (`hasUnsavedChanges` counts a read-only source's text as changed only after a change other than a Format), so Esc closes at once. The editor itself is read-only for such a source (`EditorState.readOnly`): typing and CodeMirror's undo do not act; reopen the IDE to see the original.

Keys while open are handled by one `keydown` listener on `window` in the capture phase, and only while the IDE is the topmost modal (`modalLock.isTopmost(this)`), so with the Settings modal over it they belong to that modal. It runs before every listener on the document and below, and before window-capture listeners added after the IDE first opened. A key it handles is consumed (`preventDefault()` and `stopImmediatePropagation()`), so neither the page's own shortcuts nor the browser's Save page / Find act on it:

- Ctrl/Cmd+S saves (and closes); Ctrl/Cmd+F opens search (not with Vim mode on); Shift+Alt+F formats. Shift+Alt+F is matched on the physical key (`event.code`), because Option changes the character on a Mac; Ctrl/Cmd+S and Ctrl/Cmd+F are matched on the character (`event.key`), like the browser's own Save page and Find they stand in for, so they follow the keyboard layout.
- With Vim mode on, Escape is Vim's first (see Vim mode below).
- Escape first leaves CodeMirror's own popups to CodeMirror: while the completion list (`completionStatus`) or the search panel (`searchPanelOpen`) is open, the modal does not act, and CodeMirror's Escape closes the popup.
- Otherwise Escape closes the IDE, unless there are unsaved changes (`hasUnsavedChanges`: the text differs from what was opened; on a read-only source, only after a change other than a Format). Then the first Escape only shows `DISCARD_PROMPT` in the footer, and a second Escape within `FOOTER_TIMES.discardMs` (3 s) discards the changes and closes. Typing after the prompt takes it back. This prompt never uses a browser dialog (only closing the tab does: see below).
- Every other key passes this listener untouched, including `Ctrl+Backspace` (Mac `Alt+Backspace`), CodeMirror's `deleteGroupBackward`.

**Unsaved work and Ctrl+W.** `Ctrl+W` (Vim's delete-word-back in insert mode) is the browser's close-tab key: no page or extension receives it. So while `hasUnsavedChanges` is true, `syncUnloadGuard()` keeps one `beforeunload` listener (`onBeforeUnload`: `preventDefault()` and `returnValue = ''`) on `window`, and the browser asks "Leave site?" before closing or reloading the tab. It runs on every text change (the update listener), after `:w`, on open and on close, and adds or removes the listener only when the state flips, so typing costs one comparison; undoing back to the opened text takes it off. `dispose()` removes it as well. The listener never stops propagation: the page's own `beforeunload` listeners are left alone. The content script's `window` is the page's, where `beforeunload` works in both browsers.

**Footer.** One `FooterStatus` (`footer.ts`) owns the status line. The discard prompt shows while it is armed, alone; a Format message that comes meanwhile waits under it rather than replacing it, and shows once the prompt is gone if its time has not run out; otherwise the open's own text shows (the scope status, or a default). With Vim mode on, the Vim mode line (`setMode()`) comes first, before the message or the open's own text: `-- NORMAL -- · Step 3.4 · 12 variables in scope`. When the discard window closes the prompt goes by itself, and the next Escape asks again.

**Vim mode** (the `ideVim` setting, off by default; `vim.ts`):

1. **Loading.** `vim.ts` and `@replit/codemirror-vim` are their own chunk. With the setting on, `Ide.openIdeFor()` starts `import('./vim')` at the same time as `import('./modal')`, so it adds no wait of its own. `IdeModal.syncVim()` runs after every `createView()` and on every settings change: it puts `vimExtension(this.vimHost)` into `vimCompartment`, the first of the view's extensions (the library's keys come before every other keymap), or empties it. Switching the setting while the IDE is open therefore applies at once. If the chunk is not in yet, the view opens without Vim and gets it when it arrives. With the setting off the chunk is never requested; a failed load is forgotten and says so in the footer.
2. **Esc** (`escapeBelongsToVim()`). While the completion list or a hover tooltip is open, the IDE closes it and consumes the key, so Vim does not also leave insert mode. While the search panel or Vim's `:` / `/` prompt is open, or Vim is in insert, replace or visual mode, or has keys pending (a count, a register, an operator, a partial command: `vimKeyState()` reads `getCM(view).state.vim`), the IDE steps aside and Vim handles Esc. In normal mode with nothing pending, Esc is the IDE's as without Vim: `closeOrAskFirst()`.
3. **Ex commands**, defined once per page with `Vim.defineEx` and run for the view's `VimHost` after the library's own key handling has finished: `:w` writes the text back and stays open (`writeAndStay()`: what was written is no longer an unsaved change); `:q` closes, asking first like Esc (a second `:q` or Esc within the window discards); `:q!` closes and discards; `:wq` is Save; `:x` is Save with unsaved changes, else a plain close. On a read-only source `:w`, `:wq` and `:x` show Save's toast and write nothing.
4. **Clipboard**, like Vim's `clipboard=unnamedplus`. The library has no hook for it and `defineRegister()` cannot replace the unnamed register, so `syncClipboard()` wraps `pushText()` on the instance the public `Vim.getRegisterController()` returns (once per controller). After every yank, delete or change that names no register, and after `:yank` (which names register 0), the unnamed register's text (what `p` would paste; a linewise yank ends in a newline) goes to `IdeModal.copyToClipboard()`, which calls `copyText()` in a microtask: the Clipboard API, else `execCommand('copy')` through a scratch textarea, then the focus goes back to the editor. `copiesToClipboard()` is the rule: not `"_`, not a named register (`"ay`), not `"+` (the library writes it to the clipboard itself). A visual-mode `p` puts the replaced text in the unnamed register without `pushText()`, so it is not copied. `p` pastes Vim's register; `"+p` is the library's `navigator.clipboard.readText()`, and no `clipboardRead` permission is declared, so the browser may ask. `Ctrl+V` in insert mode is the browser's paste.
5. **Keys.** `Ctrl/Cmd+S` and `Shift+Alt+F` are the IDE's in every Vim mode. `Ctrl/Cmd+F` is not handled while Vim is on: Vim's page down; search is `/`, `?`, `n`, `N`. All other keys (`Ctrl+V`, `Ctrl+R`, `Ctrl+D`/`Ctrl+U`, `Ctrl+O`, …) reach CodeMirror and Vim. Deleting back in insert mode: `Ctrl+U` is the library's (to line start); `Ctrl+Backspace` falls through to CodeMirror's `deleteGroupBackward`; `Ctrl+H` is `insertModeKeys` (`deleteCharBackward`, insert mode only), because the library leaves it alone and CodeMirror binds it only on a Mac. `Ctrl+W` never arrives (see "Unsaved work and Ctrl+W"). In insert mode the completion list's keys (`↑`/`↓`, `Enter`) are not Vim's, so completion works as without Vim.
6. **Footer.** `VimBridge`, a view plugin after `vim()`, registers the view's host and follows the library's `vim-mode-change`, `vim-keypress` and `vim-command-done` events; `modeLine()` gives `-- NORMAL --`, `-- INSERT --`, `-- VISUAL LINE --`, … plus pending keys (`-- NORMAL --  2d`), and `FooterStatus.setMode()` shows it.
7. **Look and read-only.** `drawSelection()` comes with Vim mode (it hides the browser's own selection, so a visual selection must be drawn), and the block cursor is the accent blue. On a read-only source the library refuses changes and insert mode (`EditorState.readOnly`); moves, search and yanks work.

Closing, in one place: **Save** (or Ctrl/Cmd+S) writes the text into the source textarea, fires `input` and `change`, and closes; for a read-only source Save is disabled and Ctrl+S only shows a toast. **Cancel** and **×** close without saving and without asking: they are explicit. **Escape** and a **click on the backdrop** close at once when nothing changed; with unsaved changes they ask first (`closeOrAskFirst()`), and a second press or click (either one) within the window discards.

**Variables** (only when a scope was passed):

- Completion is offered after `#{` and on bare names inside an open `#{ …`. Only in-scope variables are listed. After `#{name.` it offers `element`. The source is placed first in each mode's completion list.
- Hover over a known name shows where it comes from.
- Lint warns on an unclosed `#{`, an unknown name (only when the scan found any variables), and the output of the current or a later step. Only simple `#{name}` / `#{name.path}` forms are checked.
- The footer shows `scopeStatus()`, for example `Step 3.4 · 12 variables in scope`.

## How it connects

- **Used by:** `ad-content.ts` (with `scanScope` from [`../ad-scope/`](../ad-scope/) as the `ScopeProvider`) and `pd-content.ts` (without one).
- **Depends on:** `ui/hover-overlay.ts`, `ui/modal-lock.ts`, `ui/toast.ts`, `ui/modal.ts`, `ui/styles.ts`, `ui/theme.ts`, `utils/`, `core/settings.ts`, `settings/modal.ts` (the IDE's ⚙ button), `config/settings.ts`, `config/namespace.ts`, `shared/logger.ts`, the `@codemirror/*` packages, `sql-formatter` (only in the formatter chunk), and `@replit/codemirror-vim` (only in the Vim chunk).

## Conventions

- **Keep `format.ts` lazy too.** `modal.ts` reaches it only through `import('./format')` (and a type-only `typeof import`). A static import would put sql-formatter (~75 KB) into the IDE chunk; `tests/build/bundle.test.ts` fails if it reaches the IDE chunk's or the page's static closure. Import only `formatDialect` and the `postgresql` dialect, never `format`, which pulls in every dialect.
- **Keep `vim.ts` lazy too.** `modal.ts` and `index.ts` reach it only through `import('./vim')` (and type-only imports), and only while `ideVim` is on. A static import would put the Vim library (~125 KB) into the IDE chunk; `tests/build/bundle.test.ts` fails if it reaches the IDE chunk's or the page's static closure. `vim()` stays first in the view's extensions.
- **Keep `modal.ts` lazy.** Reach it only through `import('./modal')`. A static import from page-load code puts CodeMirror (~600 KB) back into every page load; `tests/build/bundle.test.ts` fails if that happens.
- **One graph.** The IDE chunk shares `settings`, `modalLock`, `toast` and `settingsModal` with the page bundle through shared chunks. Never build it separately (see [AGENTS.md](../../../../AGENTS.md)).
- **No per-textarea DOM and no rescans.** Use delegation through `HoverOverlay`.
- **The IDE never reads the page for variables.** It only gets a `VariableScope`. `scope.ts` stays types-only so the PD bundle carries no scanner.
- Keep pure logic in `language.ts` and `references.ts`, so it can be tested without loading CodeMirror.
- `Ide.stop()` disposes the modal only if it was ever loaded.

## Testing

- [`tests/designer/features/language.test.ts`](../../../../tests/designer/features/language.test.ts): `detectLanguage()`.
- [`tests/designer/features/format.test.ts`](../../../../tests/designer/features/format.test.ts): `formatCode()` for SQL (placeholders with spaces, quotes and braces, `:param`, `::jsonb`, jsonb operators, several statements, lower-case data types, the statement-word check, a parse error, document line numbers, a selection's indentation) and JSON (bare and in-string placeholders, ones holding double quotes, big numbers, invalid input), idempotence, and `mapPosition()`.
- [`tests/designer/features/ide-footer.test.ts`](../../../../tests/designer/features/ide-footer.test.ts): `FooterStatus` (the prompt expiring, a message waiting under it, `reset()`, the Vim mode line).
- [`tests/designer/features/ide-vim.test.ts`](../../../../tests/designer/features/ide-vim.test.ts): Vim mode (no load with the setting off, on at open, live toggle, the mode line, Esc in each mode, the ex commands, the clipboard sync, read-only sources, Ctrl+S / Shift+Alt+F / Ctrl+F, keys not reaching the page, insert-mode Ctrl+Backspace / Ctrl+H / Ctrl+U).
- [`tests/designer/features/ide-unload.test.ts`](../../../../tests/designer/features/ide-unload.test.ts): the `beforeunload` guard (only while unsaved; gone after Save, Cancel, dispose, a discard, `:w` and an undo back to the opened text; one listener, added once; the page's own listeners untouched; not for a read-only Format), and `Ctrl+Backspace` without Vim.
- [`tests/designer/features/variables.test.ts`](../../../../tests/designer/features/variables.test.ts): completion, expression finding, lint, hover lookup and footer status.
- [`tests/designer/ui/hover-overlay.test.ts`](../../../../tests/designer/ui/hover-overlay.test.ts): the overlay.
- [`tests/designer/features/modal-escape.test.ts`](../../../../tests/designer/features/modal-escape.test.ts): Escape and a click on the backdrop (unchanged text, the discard prompt, the search panel, the Settings modal on top), Ctrl+S under the Settings modal, that the keys the IDE handles never reach the page's own listeners, and Format (one undoable transaction, no-op on formatted text, selection only and its indentation, errors, a parse error, Shift+Alt+F on the physical key only, a read-only source, Esc asking there after another change, a Format message under the discard prompt).
- [`tests/build/bundle.test.ts`](../../../../tests/build/bundle.test.ts): the IDE stays out of the page-load bundle, and the formatter and Vim mode out of both it and the IDE chunk.
- [`tests/e2e/`](../../../../tests/e2e/): in real browsers, the overlay (also on a disabled textarea), lazy loading, SQL detection, the footer status, Format through Shift+Alt+F (the formatter chunk loads), the shared modal lock, and Vim mode once switched on in the Settings modal (its chunk loads, the footer shows the mode, Esc in insert mode keeps the IDE open, Esc in normal mode closes it).

How to run them is in the Development section of the [root README](../../../../README.md).

## Adding or changing things

- **A new language mode:** add it to `LanguageMode` and `LANGUAGE_OPTIONS` and teach `detectLanguage()` in `language.ts`, then add its extension to `getLanguageExtensionForMode()` and its completion to `getAutocompleteExtensionsForMode()` in `modal.ts`.
- **Formatting another mode:** add it to `FormattableMode` and `isFormattable()` in `language.ts` and to `formatCode()` in `format.ts`; keep any library it needs inside `format.ts`'s chunk, and keep `#{ … }` placeholders out of the library's sight as the SQL and JSON paths do.
- **Overlay changes** (`index.ts` or `ui/hover-overlay.ts`): keep one controls element and no per-textarea DOM (see [AGENTS.md](../../../../AGENTS.md)); run `tests/designer/ui/hover-overlay.test.ts` and the end-to-end suite, which checks the overlay on a normal and a disabled textarea in real browsers.
