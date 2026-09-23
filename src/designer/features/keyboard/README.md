# `src/designer/features/keyboard/`

Keyboard shortcuts on designer pages. Runs in the content script on AD and PD pages. Switched by the `runTestShortcut` setting (shown as **Keyboard Shortcuts**).

## Contents

| File | What it does |
|---|---|
| [`shortcuts.ts`](shortcuts.ts) | `KeyboardShortcuts`, the `Feature` that handles every shortcut below |

| Shortcut | What it does | Where |
|---|---|---|
| Ctrl+Shift+Enter | Commits the focused field, then clicks Run Test (`triggerRunTest()` from `run-test/`) | anywhere, even in a field |
| Esc Esc (within 500 ms) | Commits and leaves the focused field | in an editable field |
| Shift+L | Copies a `category::method` link as HTML and Markdown | AD, not in a field |
| Shift+J | Opens the JSON input editor | AD, only when an opener was passed in, not in a field |

## How it works

- One `keydown` listener on `window`, in the capture phase. `onKeydown` returns at once while `modalLock.isLocked`, so shortcuts never fire behind an open modal.
- "Commit" (`commitActiveElement()`) dispatches `change`, blurs the field and dispatches `blur`. AD test inputs only save an edit on blur. After a commit, Run Test waits `TIMINGS.runTestCommitSettle` before clicking.
- The listener can go dead while the SPA boots, so `start()` re-attaches it through a `Rearm` and on every `pageObserver` notification. `attach` removes before it adds, so it is never added twice.
- The constructor takes an optional `openJsonEditor`. Only `ad-content.ts` passes one (`jsonEditorModal.open`), so PD pages do not bundle the JSON editor and Shift+J does nothing there.

## How it connects

- **Used by:** `ad-content.ts` and `pd-content.ts`.
- **Depends on:** `run-test/`, `ui/modal-lock.ts`, `ui/toast.ts`, `utils/dom.ts` (method name and category), `core/rearm.ts`, `core/observer.ts`, `config/routes.ts`, `config/timings.ts`, `navigator.clipboard`.

## Conventions

Shortcuts that act on the page check `modalLock.isLocked`. Shortcuts that are plain letters (Shift+L, Shift+J) must be ignored while the user types in a field.

## Testing

[`tests/designer/features/shortcuts.test.ts`](../../../../tests/designer/features/shortcuts.test.ts) covers Run Test (click, modal lock, commit first, disabled button, `stop()`) and Esc Esc. How to run it is in the Development section of the [root README](../../../../README.md).

## Adding or changing things

Add a branch to `onKeydown`, and update the setting's description in `config/settings.ts`, the shortcut table in the root README and [AGENTS.md](../../../../AGENTS.md) if needed. Browser-level shortcuts (the ones in `manifest.json` `commands`) are handled in the background, not here.
