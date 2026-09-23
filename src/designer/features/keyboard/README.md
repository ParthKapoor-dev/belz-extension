# `src/designer/features/keyboard/`

Keyboard shortcuts on designer pages. Runs in the content script on AD and PD pages. Switched by the `runTestShortcut` setting (shown as **Keyboard Shortcuts**), which covers every shortcut here.

## Contents

| File | What it does |
|---|---|
| [`shortcuts.ts`](shortcuts.ts) | `KeyboardShortcuts`, the `Feature` that handles every shortcut below, and the `ShortcutActions` a page passes in |
| [`ad-link.ts`](ad-link.ts) | `copyAdRichLink()`: the Shift+L action on AD pages |

| Shortcut | What it does | Where |
|---|---|---|
| Ctrl+Shift+Enter | Commits the focused field, then clicks Run Test | AD, even in a field; only when a Run Test button is found |
| Esc Esc (within 500 ms) | Commits and leaves the focused field | AD and PD, in an editable field |
| Shift+L | Copies a `category::method` link as HTML and Markdown | AD, not while typing |
| Shift+J | Opens the JSON input editor | AD, not while typing; only while the JSON Editor setting is on |

## How it works

- **Actions are passed in per page.** The constructor takes `ShortcutActions`: `runTest` (`available()` and `run()`), `copyLink` and `openJsonEditor`. `ad-content.ts` passes all three (`runTestAction` from [`../run-test/`](../run-test/), `copyAdRichLink`, and an opener that returns `false` while the `jsonEditor` setting is off). `pd-content.ts` passes none, so on PD pages only Esc Esc is handled, and Ctrl+Shift+Enter, Shift+L and Shift+J reach the page untouched.
- **A key is claimed only when something is done with it.** Ctrl+Shift+Enter calls `preventDefault()` only when `runTest.available()` finds a Run Test button; Shift+J only when the opener returns `true`.
- One `keydown` listener on `window`, in the capture phase. `onKeydown` returns at once while `modalLock.isLocked`, so shortcuts never fire behind an open modal.
- "Commit" (`commitActiveElement()`) dispatches `change`, blurs the focused field and dispatches `blur`. AD test inputs only save an edit on blur. After a commit, Run Test waits `TIMINGS.runTestCommitSettle` before clicking; `stop()` cancels that wait.
- **Typing.** `isTyping()` treats a key as text when it comes from an editable element (`event.composedPath()[0]`, so a field inside an open shadow root counts), or when focus is in a field (looking inside shadow roots) or in an iframe. Shift+L and Shift+J do nothing then.
- The listener can go dead while the SPA boots, so `start()` re-attaches it through a `Rearm` and on every `pageObserver` notification. `attach` removes before it adds, so it is never added twice.
- `copyAdRichLink()` builds the label from `extractServiceCategory()` and `extractMethodName()`, and copies it with `copyRichLink()` from [`shared/rich-link.ts`](../../../shared/rich-link.ts), which escapes the label for the HTML form.

## How it connects

- **Used by:** `ad-content.ts` (with actions) and `pd-content.ts` (without).
- **Depends on:** `ui/modal-lock.ts`, `ui/toast.ts`, `core/rearm.ts`, `core/observer.ts`, `config/timings.ts`; `ad-link.ts` also uses `utils/dom.ts` and `shared/rich-link.ts`.

## Conventions

Shortcuts that act on the page check `modalLock.isLocked`. Plain-letter shortcuts must be ignored while the user types. A page-specific action is passed in from its entry, never imported here, so pages that lack it do not bundle it.

## Testing

[`tests/designer/features/shortcuts.test.ts`](../../../../tests/designer/features/shortcuts.test.ts) covers Run Test (click, modal lock, commit first, a disabled or missing button leaves the key alone, `stop()`), the PD wiring, Shift+L and Shift+J (the JSON Editor setting, typing in a field, in a shadow root, focus in an iframe) and Esc Esc. How to run it is in the Development section of the [root README](../../../../README.md).

## Adding or changing things

Add a branch to `onKeydown` (and an action to `ShortcutActions` if it is page-specific), then update the setting's description in `config/settings.ts`, the shortcut table in the root README and [AGENTS.md](../../../../AGENTS.md) if needed. Browser-level shortcuts (the ones in `manifest.json` `commands`) are handled in the background, not here.
