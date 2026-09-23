import { afterEach, describe, expect, test } from 'bun:test';
import { openSearchPanel } from '@codemirror/search';
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
    expect(document.getElementById(STATUS_ID)!.textContent).toContain('press Esc again to discard');
    esc();
    expect(isOpen()).toBe(false);
    expect(textarea.value).toBe('a'); // discarded, not written back
  });

  test('typing after the prompt takes it back: the next Esc asks again', () => {
    const { view, isOpen } = openEditor('a');
    view()!.dispatch({ changes: { from: 1, insert: 'b' } });
    esc();
    view()!.dispatch({ changes: { from: 2, insert: 'c' } });
    expect(document.getElementById(STATUS_ID)!.textContent).not.toContain('press Esc again');
    esc();
    expect(isOpen()).toBe(true);
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
