import { beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../../fakes/chrome';
import { SETTINGS_STORAGE_KEY } from '../../../src/config/storage-keys';
import {
  loadSettings,
  setSetting,
  subscribeSettings
} from '../../../src/designer/core/settings';
import { DEFAULT_SETTINGS } from '../../../src/config/settings';

/** Simulate a change arriving from another tab or the options page. */
function storeFromElsewhere(value: unknown) {
  fakeChrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: value });
}

beforeEach(() => {
  fakeChrome.reset();
  storeFromElsewhere({ ...DEFAULT_SETTINGS });
});

describe('settings', () => {
  test('a stored change from elsewhere is picked up', () => {
    storeFromElsewhere({ ...DEFAULT_SETTINGS, jsonEditor: false });
    expect(loadSettings().jsonEditor).toBe(false);
  });

  test('stored values are sanitised', () => {
    storeFromElsewhere({
      titleUpdater: 0,
      textareaEditorWrap: 'sideways',
      textareaEditorFontSize: '16',
      unknownKey: 'x'
    });
    const s = loadSettings();
    expect(s.titleUpdater).toBe(false);
    expect(s.textareaEditorWrap).toBe(DEFAULT_SETTINGS.textareaEditorWrap);
    expect(s.textareaEditorFontSize).toBe(16);
    expect('unknownKey' in s).toBe(false);
    // Keys missing from storage keep their defaults.
    expect(s.outputCopy).toBe(DEFAULT_SETTINGS.outputCopy);
  });

  test('an unsupported font size falls back to the default', () => {
    storeFromElsewhere({ textareaEditorFontSize: 99 });
    expect(loadSettings().textareaEditorFontSize).toBe(DEFAULT_SETTINGS.textareaEditorFontSize);
  });

  test('a non-object in storage is ignored', () => {
    storeFromElsewhere({ ...DEFAULT_SETTINGS, outputCopy: false });
    storeFromElsewhere('garbage');
    expect(loadSettings().outputCopy).toBe(false);
  });

  test('setSetting persists and notifies subscribers', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeSettings((s: any) => seen.push(s.runTestShortcut));
    setSetting('runTestShortcut', false);
    unsubscribe();

    expect(seen[0]).toBe(true); // called immediately with the current value
    expect(seen.at(-1)).toBe(false);
    expect((fakeChrome.storage.local.data.get(SETTINGS_STORAGE_KEY) as any).runTestShortcut).toBe(false);
  });

  test('setSetting ignores unknown keys and no-op changes', () => {
    let calls = 0;
    const unsubscribe = subscribeSettings(() => calls++);
    calls = 0;
    setSetting('notASetting', true);
    setSetting('titleUpdater', true); // already true
    unsubscribe();
    expect(calls).toBe(0);
  });

  test('loadSettings returns a copy', () => {
    const s = loadSettings();
    s.titleUpdater = false;
    expect(loadSettings().titleUpdater).toBe(true);
  });

  test('a subscriber that throws does not stop the others', () => {
    let reached = false;
    const a = subscribeSettings(() => { throw new Error('boom'); });
    const b = subscribeSettings(() => { reached = true; });
    reached = false;
    setSetting('outputCopy', false);
    a();
    b();
    expect(reached).toBe(true);
  });
});
