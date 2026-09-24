import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Vim, getCM } from '@replit/codemirror-vim';
import { searchPanelOpen } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { waitFor } from '../../wait';
import { IdeModal } from '../../../src/designer/features/ide/modal';
import { copiesToClipboard, modeLine } from '../../../src/designer/features/ide/vim';
import { settings } from '../../../src/designer/core/settings';
import { modalLock } from '../../../src/designer/ui/modal-lock';
import { toast } from '../../../src/designer/ui/toast';
import { ns } from '../../../src/config/namespace';

// The IDE with the IDE Vim Mode setting: loading, live toggling, Esc, the ex
// commands, the clipboard sync and the IDE's own keys. Assertions read plain
// values only, never DOM-holding ones.

const STATUS_ID = ns('IdeStatus');
const status = () => document.getElementById(STATUS_ID)!.textContent ?? '';

/** The IDE's private parts a test reads. */
interface IdeInternals {
  view: EditorView | null;
  vimLoad: Promise<unknown> | null;
  vimActive: boolean;
}

let writes: string[] = [];
const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  writes = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => { writes.push(text); } }
  });
});

const modals: IdeModal[] = [];
afterEach(() => {
  for (const modal of modals.splice(0)) modal.dispose();
  settings.set('ideVim', false);
  document.body.innerHTML = '';
  while (modalLock.isLocked) modalLock.unlock();
  if (realClipboard) Object.defineProperty(navigator, 'clipboard', realClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
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
  const view = () => internals.view;
  const isOpen = () => internals.view !== null;
  const cm = () => getCM(internals.view!)!;
  return { editor, textarea, view, isOpen, cm, internals };
}

/** Open with Vim mode on, once its chunk is in. */
async function openVim(text = 'select 1', options: { readOnly?: boolean } = {}) {
  settings.set('ideVim', true);
  const opened = openEditor(text, options);
  await waitFor(() => opened.internals.vimActive && getCM(opened.view()!) !== null);
  return opened;
}

/** Keys the way Vim reads them (`i`, `<Esc>`, `y`, …). */
function keys(opened: { cm: () => ReturnType<typeof getCM> }, ...sequence: string[]): void {
  for (const key of sequence) Vim.handleKey(opened.cm()!, key, 'user');
}

/** An ex command, as typed after `:`. */
function ex(opened: { cm: () => ReturnType<typeof getCM> }, input: string): void {
  Vim.handleEx(opened.cm() as unknown as Parameters<typeof Vim.handleEx>[0], input);
}

/** A key press at the editor, bubbling up, like a user's. Returns whether it was prevented. */
function press(view: EditorView, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Let the ex commands' deferred actions run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('loading', () => {
  test('with the setting off, the Vim chunk is never requested', () => {
    const { view, internals } = openEditor();
    expect(internals.vimLoad === null).toBe(true);
    expect(getCM(view()!) === null).toBe(true);
    expect(status()).not.toContain('NORMAL');
  });

  test('with the setting on, the IDE opens in Vim normal mode', async () => {
    const { view } = await openVim();
    expect(getCM(view()!)?.state.vim?.insertMode ?? null).toBe(false);
    expect(status()).toContain('-- NORMAL --');
  });

  test('switching the setting while the IDE is open turns Vim mode on and off live', async () => {
    const opened = openEditor();
    settings.set('ideVim', true);
    await waitFor(() => getCM(opened.view()!) !== null);
    expect(status()).toContain('-- NORMAL --');
    settings.set('ideVim', false);
    expect(getCM(opened.view()!) === null).toBe(true);
    expect(opened.internals.vimActive).toBe(false);
    expect(status()).not.toContain('NORMAL');
  });
});

describe('the mode line', () => {
  test('shows the mode and the keys typed so far', async () => {
    const opened = await openVim('a b c');
    keys(opened, 'i');
    expect(status()).toContain('-- INSERT --');
    keys(opened, '<Esc>');
    // Typed keys, through the editor: Vim keeps the pending ones for the line.
    press(opened.view()!, { key: '2' });
    press(opened.view()!, { key: 'd' });
    expect(status()).toContain('-- NORMAL --  2d');
    press(opened.view()!, { key: 'Escape' });
    expect(opened.isOpen()).toBe(true);
    expect(status()).not.toContain('2d');
    keys(opened, '<Esc>', 'v');
    expect(status()).toContain('-- VISUAL --');
  });

  test('gives way to the discard prompt while it is armed', async () => {
    const opened = await openVim('a');
    opened.view()!.dispatch({ changes: { from: 1, insert: 'b' } });
    press(opened.view()!, { key: 'Escape' });
    expect(status()).toContain('again to discard');
    expect(status()).not.toContain('NORMAL');
  });

  test('modeLine()', () => {
    expect(modeLine(undefined)).toBe('');
    expect(modeLine({ mode: 'visual line', insertMode: false, status: '"a' } as never)).toBe('-- VISUAL LINE --  "a');
    // Typed text is not a pending key.
    expect(modeLine({ mode: 'insert', insertMode: true, status: 'abc' } as never)).toBe('-- INSERT --');
  });
});

describe('Esc', () => {
  test('in insert mode goes back to normal mode and keeps the IDE open', async () => {
    const opened = await openVim();
    keys(opened, 'i');
    press(opened.view()!, { key: 'Escape' });
    expect(opened.isOpen()).toBe(true);
    expect(opened.cm().state.vim?.insertMode ?? null).toBe(false);
    expect(status()).toContain('-- NORMAL --');
  });

  test('in visual mode, or with an operator pending, is Vim\'s', async () => {
    const opened = await openVim('one two');
    keys(opened, 'v');
    press(opened.view()!, { key: 'Escape' });
    expect(opened.isOpen()).toBe(true);
    expect(opened.cm().state.vim?.visualMode ?? null).toBe(false);
    keys(opened, 'd');
    press(opened.view()!, { key: 'Escape' });
    expect(opened.isOpen()).toBe(true);
  });

  test('in normal mode closes the IDE', async () => {
    const opened = await openVim();
    press(opened.view()!, { key: 'Escape' });
    expect(opened.isOpen()).toBe(false);
  });

  test('in normal mode with unsaved changes asks first; a second Esc discards', async () => {
    const opened = await openVim('a');
    opened.view()!.dispatch({ changes: { from: 1, insert: 'b' } });
    press(opened.view()!, { key: 'Escape' });
    expect(opened.isOpen()).toBe(true);
    press(opened.view()!, { key: 'Escape' });
    expect(opened.isOpen()).toBe(false);
    expect(opened.textarea.value).toBe('a');
  });
});

describe('ex commands', () => {
  test(':w writes the text back and stays open; the text is then saved', async () => {
    const opened = await openVim('a');
    opened.view()!.dispatch({ changes: { from: 1, insert: 'b' } });
    ex(opened, 'w');
    await settle();
    expect(opened.textarea.value).toBe('ab');
    expect(opened.isOpen()).toBe(true);
    expect(opened.editor.hasUnsavedChanges).toBe(false);
  });

  test(':q closes, asking first over unsaved changes', async () => {
    const clean = await openVim('a');
    ex(clean, 'q');
    await settle();
    expect(clean.isOpen()).toBe(false);

    const dirty = await openVim('a');
    dirty.view()!.dispatch({ changes: { from: 1, insert: 'b' } });
    ex(dirty, 'q');
    await settle();
    expect(dirty.isOpen()).toBe(true);
    expect(status()).toContain('again to discard');
    ex(dirty, 'q');
    await settle();
    expect(dirty.isOpen()).toBe(false);
    expect(dirty.textarea.value).toBe('a');
  });

  test(':q! closes and drops unsaved changes', async () => {
    const opened = await openVim('a');
    opened.view()!.dispatch({ changes: { from: 1, insert: 'b' } });
    ex(opened, 'q!');
    await settle();
    expect(opened.isOpen()).toBe(false);
    expect(opened.textarea.value).toBe('a');
  });

  for (const command of ['wq', 'x']) {
    test(`:${command} writes and closes`, async () => {
      const opened = await openVim('a');
      opened.view()!.dispatch({ changes: { from: 1, insert: 'b' } });
      ex(opened, command);
      await settle();
      expect(opened.isOpen()).toBe(false);
      expect(opened.textarea.value).toBe('ab');
    });
  }

  test(':x with nothing changed just closes', async () => {
    const opened = await openVim('a');
    let written = 0;
    opened.textarea.addEventListener('input', () => { written++; });
    ex(opened, 'x');
    await settle();
    expect(opened.isOpen()).toBe(false);
    expect(written).toBe(0);
  });

  test('on a read-only source, :w and :wq write nothing and say so', async () => {
    const shown = spyOn(toast, 'show');
    try {
      const opened = await openVim('a', { readOnly: true });
      ex(opened, 'w');
      await settle();
      ex(opened, 'wq');
      await settle();
      expect(opened.isOpen()).toBe(true);
      expect(shown.mock.calls.map((call) => String(call[0]))).toEqual([
        'Read-only field — nothing was written back',
        'Read-only field — nothing was written back'
      ]);
    } finally {
      shown.mockRestore();
    }
  });
});

describe('clipboard', () => {
  test('a yank also goes to the clipboard, as the unnamed register holds it', async () => {
    const opened = await openVim('hello world');
    opened.view()!.dispatch({ selection: { anchor: 0 } });
    keys(opened, 'y', 'y');
    keys(opened, 'y', 'i', 'w');
    await settle();
    expect(writes).toEqual(['hello world\n', 'hello']);
  });

  test('deletes and changes do too; the black hole and named registers do not', async () => {
    const opened = await openVim('one\ntwo\nthree');
    opened.view()!.dispatch({ selection: { anchor: 0 } });
    keys(opened, '"', '_', 'd', 'd'); // "_dd: nowhere
    keys(opened, '"', 'a', 'y', 'y'); // "ayy: register a only
    keys(opened, 'd', 'd');
    await settle();
    expect(writes).toEqual(['two\n']);
    expect(opened.view()!.state.doc.toString()).toBe('three');
  });

  test('on a read-only source, yanks work and edits do not', async () => {
    const opened = await openVim('one two', { readOnly: true });
    // Unfocused: happy-dom reports a selection change inside CodeMirror's
    // update (browsers do so later), which CodeMirror logs as an error.
    opened.view()!.contentDOM.blur();
    keys(opened, 'y', 'y');
    await settle();
    expect(writes).toEqual(['one two\n']);
    keys(opened, 'd', 'd', 'i');
    expect(opened.view()!.state.doc.toString()).toBe('one two');
    expect(opened.cm().state.vim?.insertMode ?? null).toBe(false);
  });

  test('copiesToClipboard()', () => {
    expect(copiesToClipboard(undefined, 'yank')).toBe(true);
    expect(copiesToClipboard(null, 'delete')).toBe(true);
    expect(copiesToClipboard('', 'change')).toBe(true);
    expect(copiesToClipboard('0', 'yank')).toBe(true); // :yank
    expect(copiesToClipboard('a', 'yank')).toBe(false);
    expect(copiesToClipboard('+', 'yank')).toBe(false); // the library copies "+ itself
    expect(copiesToClipboard('_', 'delete')).toBe(false);
  });
});

describe('the IDE\'s keys with Vim mode on', () => {
  test('Ctrl+S saves in normal mode', async () => {
    const opened = await openVim('a');
    opened.view()!.dispatch({ changes: { from: 1, insert: 'b' } });
    expect(press(opened.view()!, { key: 's', ctrlKey: true })).toBe(true);
    expect(opened.isOpen()).toBe(false);
    expect(opened.textarea.value).toBe('ab');
  });

  test('Ctrl+S saves in insert mode too', async () => {
    const opened = await openVim('a');
    keys(opened, 'i');
    press(opened.view()!, { key: 's', ctrlKey: true });
    expect(opened.isOpen()).toBe(false);
  });

  test('Shift+Alt+F formats in normal mode', async () => {
    const opened = await openVim('{"a":1}');
    press(opened.view()!, { key: 'F', code: 'KeyF', shiftKey: true, altKey: true });
    await waitFor(() => opened.view()!.state.doc.toString() === '{\n  "a": 1\n}');
    expect(opened.isOpen()).toBe(true);
  });

  test('Ctrl+F is left to Vim: no search panel, and the key is not swallowed', async () => {
    const opened = await openVim('a');
    let seen = 0;
    const listener = (event: KeyboardEvent) => { if (event.key === 'f') seen++; };
    document.addEventListener('keydown', listener, true);
    try {
      press(opened.view()!, { key: 'f', ctrlKey: true });
    } finally {
      document.removeEventListener('keydown', listener, true);
    }
    expect(seen).toBe(1);
    expect(searchPanelOpen(opened.view()!.state)).toBe(false);
  });

  test('keys typed in the IDE do not bubble on to the page', async () => {
    const opened = await openVim('a');
    let seen = 0;
    const listener = () => { seen++; };
    document.addEventListener('keydown', listener);
    try {
      keys(opened, 'i');
      press(opened.view()!, { key: 'x' });
    } finally {
      document.removeEventListener('keydown', listener);
    }
    expect(seen).toBe(0);
  });
});
