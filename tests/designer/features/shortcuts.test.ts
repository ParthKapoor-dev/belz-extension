import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { KeyboardShortcuts } from '../../../src/designer/features/keyboard/shortcuts';
import { runTestAction } from '../../../src/designer/features/run-test/index';
import { modalLock } from '../../../src/designer/ui/modal-lock';
import { waitFor } from '../../wait';

// What the Automation Designer content script wires (ad-content.ts), with the
// copy-link and JSON-editor actions recorded instead of acting.
let copied = 0;
let jsonEnabled = true;
let jsonOpened = 0;
const adShortcuts = new KeyboardShortcuts({
  runTest: runTestAction,
  copyLink: () => { copied++; },
  openJsonEditor: () => {
    if (!jsonEnabled) return false;
    jsonOpened++;
    return true;
  }
});
/** What the Page Designer content script wires: no actions. */
const pdShortcuts = new KeyboardShortcuts();

let runTestClicks = 0;

function press(init: KeyboardEventInit, target: EventTarget = document.activeElement || document.body) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(event);
  return event;
}
const runTestChord = () => press({ key: 'Enter', ctrlKey: true, shiftKey: true });

beforeEach(() => {
  document.body.innerHTML =
    '<exp-button id="runTest"><button id="inner" type="button">Run Test</button></exp-button><input id="field">';
  runTestClicks = 0;
  copied = 0;
  jsonOpened = 0;
  jsonEnabled = true;
  document.getElementById('inner')!.addEventListener('click', () => runTestClicks++);
  adShortcuts.start();
});
afterEach(() => {
  adShortcuts.stop();
  pdShortcuts.stop();
});

describe('Run Test shortcut', () => {
  test('Ctrl+Shift+Enter clicks Run Test', () => {
    const event = runTestChord();
    expect(runTestClicks).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test('does nothing while a modal holds the lock', () => {
    modalLock.lock();
    runTestChord();
    modalLock.unlock();
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
    await waitFor(() => runTestClicks === 1, 'the delayed Run Test click');
  });

  test('a disabled Run Test button is left alone, and so is the key', () => {
    (document.getElementById('inner') as HTMLButtonElement).disabled = true;
    const event = runTestChord();
    expect(runTestClicks).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  test('a page with no Run Test button keeps the key', () => {
    document.getElementById('runTest')!.remove();
    expect(runTestChord().defaultPrevented).toBe(false);
  });

  test('stop removes the shortcut', () => {
    adShortcuts.stop();
    runTestChord();
    expect(runTestClicks).toBe(0);
  });
});

describe('Page Designer wiring', () => {
  test('Ctrl+Shift+Enter, Shift+L and Shift+J are left to the page', () => {
    adShortcuts.stop();
    pdShortcuts.start();
    expect(runTestChord().defaultPrevented).toBe(false);
    expect(press({ key: 'L', shiftKey: true }).defaultPrevented).toBe(false);
    expect(press({ key: 'J', shiftKey: true }).defaultPrevented).toBe(false);
    expect(runTestClicks).toBe(0);
  });
});

describe('Shift+L and Shift+J', () => {
  test('act outside fields', () => {
    expect(press({ key: 'L', shiftKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 'J', shiftKey: true }).defaultPrevented).toBe(true);
    expect([copied, jsonOpened]).toEqual([1, 1]);
  });

  test('Shift+J follows the JSON Editor setting: off, the key is the page\'s', () => {
    jsonEnabled = false;
    expect(press({ key: 'J', shiftKey: true }).defaultPrevented).toBe(false);
    expect(jsonOpened).toBe(0);
  });

  test('are ignored while typing in a field', () => {
    document.getElementById('field')!.focus();
    press({ key: 'L', shiftKey: true });
    press({ key: 'J', shiftKey: true });
    expect([copied, jsonOpened]).toEqual([0, 0]);
  });

  test('are ignored while typing in a field inside a shadow root', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(input);
    input.focus();
    press({ key: 'L', shiftKey: true }, input);
    press({ key: 'J', shiftKey: true }, input);
    expect([copied, jsonOpened]).toEqual([0, 0]);
  });

  test('are ignored while focus is in an iframe', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    frame.focus();
    press({ key: 'L', shiftKey: true }, document.body);
    expect(copied).toBe(0);
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
