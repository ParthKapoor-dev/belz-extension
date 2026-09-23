import { beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../../fakes/chrome';
import { SETTINGS_STORAGE_KEY } from '../../../src/config/storage-keys';
import {
  SettingsStore,
  chromeSettingsStorage,
  type SettingsStorage
} from '../../../src/designer/core/settings';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/config/settings';
import { nextTask } from '../../wait';

/** An in-memory SettingsStorage whose "other tab" changes the test drives. */
function memoryStorage(initial?: unknown) {
  let stored = initial;
  let onChange: ((value: unknown) => void) | null = null;
  const writes: Settings[] = [];
  const storage: SettingsStorage = {
    read: async () => stored,
    write: (value) => {
      stored = value;
      writes.push(value);
    },
    watch: (fn) => {
      onChange = fn;
    }
  };
  return {
    storage,
    writes,
    /** Simulate a change arriving from another tab or the options page. */
    changeElsewhere(value: unknown) {
      stored = value;
      onChange?.(value);
    }
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SettingsStore', () => {
  test('starts with the defaults, then loads what is stored', async () => {
    const mem = memoryStorage({ jsonEditor: false });
    const store = new SettingsStore(mem.storage);
    expect(store.get().jsonEditor).toBe(true);
    await flush();
    expect(store.get().jsonEditor).toBe(false);
  });

  test('a stored change from elsewhere is picked up', () => {
    const mem = memoryStorage();
    const store = new SettingsStore(mem.storage);
    mem.changeElsewhere({ ...DEFAULT_SETTINGS, jsonEditor: false });
    expect(store.get().jsonEditor).toBe(false);
  });

  test('stored values are sanitised', () => {
    const mem = memoryStorage();
    const store = new SettingsStore(mem.storage);
    mem.changeElsewhere({
      titleUpdater: 0,
      textareaEditorWrap: 'sideways',
      textareaEditorFontSize: '16',
      unknownKey: 'x'
    });
    const s = store.get();
    expect(s.titleUpdater).toBe(false);
    expect(s.textareaEditorWrap).toBe(DEFAULT_SETTINGS.textareaEditorWrap);
    expect(s.textareaEditorFontSize).toBe(16);
    expect('unknownKey' in s).toBe(false);
    // Keys missing from storage keep their defaults.
    expect(s.outputCopy).toBe(DEFAULT_SETTINGS.outputCopy);
  });

  test('a non-object from elsewhere is ignored', () => {
    const mem = memoryStorage();
    const store = new SettingsStore(mem.storage);
    mem.changeElsewhere({ ...DEFAULT_SETTINGS, outputCopy: false });
    mem.changeElsewhere('garbage');
    expect(store.get().outputCopy).toBe(false);
  });

  test('set() persists and notifies subscribers', () => {
    const mem = memoryStorage();
    const store = new SettingsStore(mem.storage);
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe((s) => seen.push(s.runTestShortcut));
    store.set('runTestShortcut', false);
    unsubscribe();

    expect(seen[0]).toBe(true); // called immediately with the current value
    expect(seen.at(-1)).toBe(false);
    expect(mem.writes.at(-1)?.runTestShortcut).toBe(false);
  });

  test('set() ignores unknown keys and no-op changes', () => {
    const mem = memoryStorage();
    const store = new SettingsStore(mem.storage);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    calls = 0;
    store.set('notASetting', true);
    store.set('titleUpdater', true); // already true
    unsubscribe();
    expect(calls).toBe(0);
    expect(mem.writes).toHaveLength(0);
  });

  test('get() returns a copy', () => {
    const store = new SettingsStore(null);
    const s = store.get();
    s.titleUpdater = false;
    expect(store.get().titleUpdater).toBe(true);
  });

  test('a subscriber that throws does not stop the others', () => {
    const store = new SettingsStore(null);
    let reached = false;
    const a = store.subscribe(() => { throw new Error('boom'); });
    const b = store.subscribe(() => { reached = true; });
    reached = false;
    store.set('outputCopy', false);
    a();
    b();
    expect(reached).toBe(true);
  });
});

describe('chromeSettingsStorage', () => {
  beforeEach(() => fakeChrome.reset());

  test('reads, writes and watches chrome.storage.local', async () => {
    const storage = chromeSettingsStorage()!;
    const seen: unknown[] = [];
    storage.watch((value) => seen.push(value));

    storage.write({ ...DEFAULT_SETTINGS, jsonEditor: false });
    expect((fakeChrome.storage.local.data.get(SETTINGS_STORAGE_KEY) as Settings).jsonEditor).toBe(false);
    expect((await storage.read() as Settings).jsonEditor).toBe(false);
    await nextTask(); // storage.onChanged fires after the write, as in the browser
    expect((seen.at(-1) as Settings).jsonEditor).toBe(false);
  });
});
