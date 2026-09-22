import { beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../../fakes/chrome';
import { SETTINGS_STORAGE_KEY } from '../../../src/config/storage-keys';
import { DEFAULT_SETTINGS } from '../../../src/config/settings';
import { PageObserver } from '../../../src/designer/core/observer';
import { bootstrap } from '../../../src/designer/core/bootstrap';
import type { Feature } from '../../../src/designer/core/feature';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PageObserver', () => {
  test('calls a subscriber at once, then on DOM changes, until unsubscribed', async () => {
    const observer = new PageObserver();
    let calls = 0;
    const unsubscribe = observer.subscribe(() => calls++);
    expect(calls).toBe(1);

    document.body.append(document.createElement('div'));
    await flush();
    expect(calls).toBe(2);

    unsubscribe();
    document.body.append(document.createElement('div'));
    await flush();
    expect(calls).toBe(2);
  });

  test('a throwing subscriber does not stop the others', async () => {
    const observer = new PageObserver();
    let reached = 0;
    const a = observer.subscribe(() => { throw new Error('boom'); });
    const b = observer.subscribe(() => { reached++; });
    document.body.append(document.createElement('div'));
    await flush();
    a();
    b();
    expect(reached).toBe(2);
  });
});

/** A feature that records what it was told to do. */
class RecordingFeature implements Feature {
  log: string[] = [];
  start() { this.log.push('start'); }
  stop() { this.log.push('stop'); }
}

describe('bootstrap', () => {
  beforeEach(() => {
    fakeChrome.reset();
    document.body.innerHTML = '';
  });

  test('starts and stops each feature as its setting changes', async () => {
    fakeChrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS } });
    const copy = new RecordingFeature();
    const title = new RecordingFeature();
    bootstrap({ outputCopy: copy, titleUpdater: title });
    await flush();
    expect(copy.log).toEqual(['start']);

    fakeChrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, outputCopy: false } });
    expect(copy.log).toEqual(['start', 'stop']);
    expect(title.log).toEqual(['start']); // untouched

    fakeChrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS } });
    expect(copy.log).toEqual(['start', 'stop', 'start']);
  });

  test('a feature that fails to start is retried on the next settings change', async () => {
    let attempts = 0;
    const flaky: Feature = {
      start() {
        attempts++;
        if (attempts === 1) throw new Error('not yet');
      },
      stop() {}
    };
    fakeChrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS } });
    bootstrap({ jsonEditor: flaky });
    await flush();
    const before = attempts;
    fakeChrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, titleUpdater: false } });
    expect(attempts).toBeGreaterThan(before);
  });
});
