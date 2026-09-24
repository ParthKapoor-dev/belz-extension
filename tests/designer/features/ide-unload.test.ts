import { afterEach, describe, expect, test } from 'bun:test';
import { undo } from '@codemirror/commands';
import { Vim, getCM } from '@replit/codemirror-vim';
import type { EditorView } from '@codemirror/view';
import { waitFor } from '../../wait';
import { IdeModal } from '../../../src/designer/features/ide/modal';
import { settings } from '../../../src/designer/core/settings';
import { modalLock } from '../../../src/designer/ui/modal-lock';

// The IDE's unsaved-work guard: a beforeunload listener, so closing or
// reloading the tab (Ctrl+W among others, which no page can take) asks first,
// only while there are unsaved changes. And the word and line deletes that
// work instead of Ctrl+W. Assertions read plain values only.

interface IdeInternals {
  view: EditorView | null;
  vimActive: boolean;
}

const modals: IdeModal[] = [];
afterEach(() => {
  for (const modal of modals.splice(0)) modal.dispose();
  settings.set('ideVim', false);
  document.body.innerHTML = '';
  while (modalLock.isLocked) modalLock.unlock();
});

function openEditor(text = 'select 1', options: { readOnly?: boolean } = {}) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = !!options.readOnly;
  document.body.append(textarea);
  const editor = new IdeModal();
  modals.push(editor);
  editor.open(textarea);
  const internals = editor as unknown as IdeInternals;
  const view = () => internals.view!;
  // Unfocused: happy-dom reports a selection change inside CodeMirror's
  // update (browsers do so later), which CodeMirror logs as an error.
  view().contentDOM.blur();
  const type = (insert: string) => {
    const at = view().state.doc.length;
    view().dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length } });
  };
  return { editor, textarea, view, type, internals };
}

/** Would leaving the page ask first? A synthetic beforeunload, as the browser sends on close or reload. */
function leaveAsks(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** A key press at the editor, bubbling up, like a user's: whether it was prevented. */
function press(view: EditorView, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the Leave site prompt', () => {
  test('only while there are unsaved changes', () => {
    const { type } = openEditor('a');
    expect(leaveAsks()).toBe(false);
    type('b');
    expect(leaveAsks()).toBe(true);
  });

  test('gone once the edits are undone back to the opened text', () => {
    const { type, view } = openEditor('a');
    type('b');
    undo(view());
    expect(view().state.doc.toString()).toBe('a');
    expect(leaveAsks()).toBe(false);
    type('c');
    expect(leaveAsks()).toBe(true);
  });

  test('gone after Save, after Cancel and after dispose', () => {
    const saved = openEditor('a');
    saved.type('b');
    press(saved.view(), { key: 's', ctrlKey: true });
    expect(saved.textarea.value).toBe('ab');
    expect(leaveAsks()).toBe(false);

    const cancelled = openEditor('a');
    cancelled.type('b');
    cancelled.editor.close();
    expect(leaveAsks()).toBe(false);

    const disposed = openEditor('a');
    disposed.type('b');
    disposed.editor.dispose();
    expect(leaveAsks()).toBe(false);
  });

  test('gone after discarding with a second Esc', () => {
    const { type, view } = openEditor('a');
    type('b');
    press(view(), { key: 'Escape' });
    expect(leaveAsks()).toBe(true);
    press(view(), { key: 'Escape' });
    expect(leaveAsks()).toBe(false);
  });

  test('a reopen over unsaved changes starts clean', () => {
    const { editor, type } = openEditor('a');
    type('b');
    const other = document.createElement('textarea');
    other.value = 'x';
    document.body.append(other);
    editor.open(other);
    expect(leaveAsks()).toBe(false);
  });

  test('a Format on a read-only source does not ask', async () => {
    const { editor, view } = openEditor('{"a":1}', { readOnly: true });
    await editor.format();
    expect(view().state.doc.toString()).toBe('{\n  "a": 1\n}');
    expect(leaveAsks()).toBe(false);
  });

  test('puts one listener on window, only when the state flips', () => {
    const added: string[] = [];
    const removed: string[] = [];
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, ...rest: never[]) => {
      if (type === 'beforeunload') added.push(type);
      return (add as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, ...rest: never[]) => {
      if (type === 'beforeunload') removed.push(type);
      return (remove as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof window.removeEventListener;
    try {
      const { type, editor } = openEditor('a');
      type('b');
      type('c');
      type('d');
      expect(added.length).toBe(1);
      expect(removed.length).toBe(0);
      editor.close();
      expect(removed.length).toBe(1);
    } finally {
      window.addEventListener = add;
      window.removeEventListener = remove;
    }
  });

  test('the page\'s own beforeunload listeners still run, and are not changed', () => {
    let pageSaw = 0;
    const pageListener = () => { pageSaw++; };
    window.addEventListener('beforeunload', pageListener);
    try {
      const { type } = openEditor('a');
      expect(leaveAsks()).toBe(false);
      type('b');
      expect(leaveAsks()).toBe(true);
    } finally {
      window.removeEventListener('beforeunload', pageListener);
    }
    expect(pageSaw).toBe(2);
  });

  test('with Vim mode on too: after :w it no longer asks', async () => {
    settings.set('ideVim', true);
    const opened = openEditor('a');
    await waitFor(() => opened.internals.vimActive && getCM(opened.view()) !== null);
    opened.type('b');
    expect(leaveAsks()).toBe(true);
    Vim.handleEx(getCM(opened.view()) as unknown as Parameters<typeof Vim.handleEx>[0], 'w');
    await settle();
    expect(opened.textarea.value).toBe('ab');
    expect(leaveAsks()).toBe(false);
  });
});

describe('Ctrl+Backspace without Vim mode', () => {
  test('deletes the word before the cursor and does not reach the page', () => {
    const { view } = openEditor('select one two');
    let seen = 0;
    const listener = () => { seen++; };
    document.addEventListener('keydown', listener);
    let prevented: boolean;
    try {
      prevented = press(view(), { key: 'Backspace', code: 'Backspace', ctrlKey: true });
    } finally {
      document.removeEventListener('keydown', listener);
    }
    expect({ prevented, seen, text: view().state.doc.toString() })
      .toEqual({ prevented: true, seen: 0, text: 'select one ' });
  });
});
