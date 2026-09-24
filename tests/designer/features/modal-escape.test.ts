import { afterEach, describe, expect, test } from 'bun:test';
import { openSearchPanel } from '@codemirror/search';
import { undo, undoDepth } from '@codemirror/commands';
import { waitFor } from '../../wait';
import type { EditorView } from '@codemirror/view';
import { IdeModal } from '../../../src/designer/features/ide/modal';
import { SettingsModal } from '../../../src/designer/features/settings/modal';
import { JsonEditorModal } from '../../../src/designer/features/json-editor/modal';
import { modalLock } from '../../../src/designer/ui/modal-lock';
import { ns } from '../../../src/config/namespace';

// Esc in the extension's modals: only the topmost modal closes, CodeMirror's
// own popups close first, and unsaved edits in the IDE are not
// dropped on the first press. Assertions read plain values only.

const STATUS_ID = ns('IdeStatus');
const OVERLAY_ID = ns('IdeOverlay');

/** Click the dimmed backdrop around the IDE. */
function clickOutside(): void {
  document.getElementById(OVERLAY_ID)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** Press Esc the way a user does: at the focused element, bubbling up. */
function esc(): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  (document.activeElement || document.body).dispatchEvent(event);
  return event.defaultPrevented;
}

const modals: Array<{ dispose(): void }> = [];
function track<T extends { dispose(): void }>(modal: T): T {
  modals.push(modal);
  return modal;
}
afterEach(() => {
  for (const modal of modals.splice(0)) modal.dispose();
  document.body.innerHTML = '';
  while (modalLock.isLocked) modalLock.unlock();
});

function openEditor(text = 'select 1') {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.append(textarea);
  const editor = track(new IdeModal());
  editor.open(textarea);
  const view = () => (editor as unknown as { view: EditorView | null }).view;
  const isOpen = () => view() !== null;
  return { editor, textarea, view, isOpen };
}

describe('the IDE', () => {
  test('Esc closes it when nothing was changed', () => {
    const { isOpen } = openEditor();
    expect(isOpen()).toBe(true);
    esc();
    expect(isOpen()).toBe(false);
    expect(modalLock.isLocked).toBe(false);
  });

  test('with unsaved changes, the first Esc asks and the second discards', () => {
    const { view, isOpen, textarea } = openEditor('a');
    view()!.dispatch({ changes: { from: 1, insert: 'bc' } });
    esc();
    expect(isOpen()).toBe(true);
    expect(document.getElementById(STATUS_ID)!.textContent).toContain('again to discard');
    esc();
    expect(isOpen()).toBe(false);
    expect(textarea.value).toBe('a'); // discarded, not written back
  });

  test('typing after the prompt takes it back: the next Esc asks again', () => {
    const { view, isOpen } = openEditor('a');
    view()!.dispatch({ changes: { from: 1, insert: 'b' } });
    esc();
    view()!.dispatch({ changes: { from: 2, insert: 'c' } });
    expect(document.getElementById(STATUS_ID)!.textContent).not.toContain('again to discard');
    esc();
    expect(isOpen()).toBe(true);
  });

  test('a click outside closes it when nothing was changed', () => {
    const { isOpen } = openEditor();
    clickOutside();
    expect(isOpen()).toBe(false);
  });

  test('with unsaved changes, a click outside asks like Esc, and a second one discards', () => {
    const { view, isOpen, textarea } = openEditor('a');
    view()!.dispatch({ changes: { from: 1, insert: 'b' } });
    clickOutside();
    expect(isOpen()).toBe(true);
    expect(document.getElementById(STATUS_ID)!.textContent).toContain('again to discard');
    clickOutside();
    expect(isOpen()).toBe(false);
    expect(textarea.value).toBe('a');
  });

  test('the keys it handles never reach the page\'s own listeners', () => {
    const { editor, view, isOpen, textarea } = openEditor('a');
    const seen: string[] = [];
    const record = (event: Event) => seen.push((event as KeyboardEvent).key);
    const listeners: Array<[EventTarget, boolean]> = [[window, true], [window, false], [document, true], [document, false]];
    for (const [target, capture] of listeners) target.addEventListener('keydown', record, capture);
    try {
      const press = (key: string) => {
        const event = new KeyboardEvent('keydown', { key, ctrlKey: key !== 'Escape', bubbles: true, cancelable: true });
        (document.activeElement || document.body).dispatchEvent(event);
      };
      press('f');
      view()!.dispatch({ changes: { from: 1, insert: 'b' } });
      press('s');
      expect(textarea.value).toBe('ab'); // saved and closed
      expect(isOpen()).toBe(false);
      editor.open(textarea); // the same IDE: its listener was added before the page's
      press('Escape');
      expect(seen).toEqual([]);
    } finally {
      for (const [target, capture] of listeners) target.removeEventListener('keydown', record, capture);
    }
  });

  test('Format replaces the text in one transaction that one undo takes back', async () => {
    const { editor, view } = openEditor('select a, b from t where id = #{id}');
    await editor.format();
    expect(view()!.state.doc.toString()).toBe('SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  id = #{id}');
    expect(undoDepth(view()!.state)).toBe(1);
    undo(view()!);
    expect(view()!.state.doc.toString()).toBe('select a, b from t where id = #{id}');
  });

  test('Format on formatted text changes nothing; in plain mode it only says why', async () => {
    const { editor, view } = openEditor('SELECT\n  1');
    await editor.format();
    expect(undoDepth(view()!.state)).toBe(0);
    expect(document.getElementById(STATUS_ID)!.textContent).toBe('Already formatted');
    editor.open(Object.assign(document.createElement('textarea'), { value: 'just a note' }));
    await editor.format();
    expect(view()!.state.doc.toString()).toBe('just a note');
    expect(document.getElementById(STATUS_ID)!.textContent).toContain('SQL and JSON');
  });

  test('Format with a selection formats only the selection', async () => {
    const text = 'keep this\n{"a":1}';
    const { editor, view } = openEditor(text);
    // Unfocused: happy-dom fires selectionchange inside CodeMirror's own
    // update when a focused view writes its selection to the DOM.
    view()!.contentDOM.blur();
    view()!.dispatch({ selection: { anchor: text.indexOf('{'), head: text.length } });
    editor['setLanguage']('json');
    await editor.format();
    expect(view()!.state.doc.toString()).toBe('keep this\n{\n  "a": 1\n}');
  });

  test('invalid JSON is left as it is, and the footer says why', async () => {
    const { editor, view } = openEditor('{"a": 1,, }');
    await editor.format();
    expect(view()!.state.doc.toString()).toBe('{"a": 1,, }');
    expect(document.getElementById(STATUS_ID)!.textContent).toStartWith('Not formatted: Invalid JSON');
  });

  test('Shift+Alt+F formats, and never reaches the page', async () => {
    const { view } = openEditor('select 1 from t');
    const seen: string[] = [];
    const record = (event: Event) => seen.push((event as KeyboardEvent).key);
    const listeners: Array<[EventTarget, boolean]> = [[window, true], [window, false], [document, true], [document, false]];
    for (const [target, capture] of listeners) target.addEventListener('keydown', record, capture);
    try {
      // On a Mac, Option changes the key to another character; the code stays.
      const event = new KeyboardEvent('keydown', {
        key: 'Ï', code: 'KeyF', shiftKey: true, altKey: true, bubbles: true, cancelable: true
      });
      (document.activeElement || document.body).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => view()!.state.doc.toString().startsWith('SELECT'));
      expect(seen).toEqual([]);
    } finally {
      for (const [target, capture] of listeners) target.removeEventListener('keydown', record, capture);
    }
  });

  test('a read-only source can be formatted for reading, and has nothing unsaved', async () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'select 1 from t';
    textarea.disabled = true;
    document.body.append(textarea);
    const editor = track(new IdeModal());
    editor.open(textarea);
    await editor.format();
    const view = (editor as unknown as { view: EditorView }).view;
    expect(view.state.doc.toString()).toBe('SELECT\n  1\nFROM\n  t');
    expect(editor.hasUnsavedChanges).toBe(false);
    expect(textarea.value).toBe('select 1 from t');
  });

  // The completion list takes the same path (completionStatus instead of
  // searchPanelOpen), but it does not open under happy-dom.
  test('Esc with the search panel open is left to CodeMirror', () => {
    const { view, isOpen } = openEditor();
    openSearchPanel(view()!);
    esc();
    expect(isOpen()).toBe(true);
  });
});

describe('stacked modals', () => {
  test('Esc closes the settings modal over the IDE, not the IDE too', () => {
    const { isOpen } = openEditor();
    const settingsModal = track(new SettingsModal());
    settingsModal.open();
    esc();
    expect(settingsModal.isOpen).toBe(false);
    expect(isOpen()).toBe(true);
    esc();
    expect(isOpen()).toBe(false);
  });

  test('Esc closes the settings modal over the JSON editor, then the JSON editor', () => {
    const json = track(new JsonEditorModal());
    json.open();
    const settingsModal = track(new SettingsModal());
    settingsModal.open();
    esc();
    expect([settingsModal.isOpen, json.isOpen]).toEqual([false, true]);
    esc();
    expect(json.isOpen).toBe(false);
  });

  test('Ctrl+S does not save the IDE while the settings modal is over it', () => {
    const { view, textarea } = openEditor('a');
    view()!.dispatch({ changes: { from: 1, insert: 'b' } });
    track(new SettingsModal()).open();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(textarea.value).toBe('a');
  });
});
