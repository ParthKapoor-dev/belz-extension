import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  startRunTestShortcutFeature,
  stopRunTestShortcutFeature
} from '../../../src/designer/features/keyboard/shortcuts';
import { lockModalInteraction, unlockModalInteraction } from '../../../src/designer/ui/modal-lock';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let runTestClicks = 0;

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  (document.activeElement || document.body).dispatchEvent(event);
  return event;
}
const runTestChord = () => press({ key: 'Enter', ctrlKey: true, shiftKey: true });

beforeEach(() => {
  document.body.innerHTML =
    '<exp-button id="runTest"><button id="inner" type="button">Run Test</button></exp-button><input id="field">';
  runTestClicks = 0;
  document.getElementById('inner')!.addEventListener('click', () => runTestClicks++);
  startRunTestShortcutFeature();
});
afterEach(() => stopRunTestShortcutFeature());

describe('Run Test shortcut', () => {
  test('Ctrl+Shift+Enter clicks Run Test', () => {
    const event = runTestChord();
    expect(runTestClicks).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test('does nothing while a modal holds the lock', () => {
    lockModalInteraction();
    runTestChord();
    unlockModalInteraction();
    expect(runTestClicks).toBe(0);
  });

  test('commits a focused field before running', async () => {
    const field = document.getElementById('field') as HTMLInputElement;
    let changed = false;
    field.addEventListener('change', () => { changed = true; });
    field.focus();
    runTestChord();
    expect(changed).toBe(true);
    expect(runTestClicks).toBe(0); // waits for the app to register the blur
    await sleep(200);
    expect(runTestClicks).toBe(1);
  });

  test('a disabled Run Test button is left alone', () => {
    (document.getElementById('inner') as HTMLButtonElement).disabled = true;
    runTestChord();
    expect(runTestClicks).toBe(0);
  });

  test('stop removes the shortcut', () => {
    stopRunTestShortcutFeature();
    runTestChord();
    expect(runTestClicks).toBe(0);
  });
});

describe('Esc Esc', () => {
  test('two quick presses in a field return focus to the page', () => {
    const field = document.getElementById('field') as HTMLInputElement;
    field.focus();
    press({ key: 'Escape' });
    expect(document.activeElement === field).toBe(true);
    press({ key: 'Escape' });
    expect(document.activeElement === field).toBe(false);
  });
});
