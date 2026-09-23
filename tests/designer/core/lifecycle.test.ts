import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

/** Write the settings, and wait for storage.onChanged to reach bootstrap. */
async function writeSettings(value: unknown) {
  await fakeChrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: value });
  await flush();
}

describe('bootstrap', () => {
  /** The running bootstrap's teardown: every test stops what it started. */
  let teardown: (() => void) | null = null;

  beforeEach(() => {
    fakeChrome.reset();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  test('starts and stops each feature as its setting changes', async () => {
    await writeSettings({ ...DEFAULT_SETTINGS });
    const copy = new RecordingFeature();
    const title = new RecordingFeature();
    teardown = bootstrap({ outputCopy: copy, titleUpdater: title });
    await flush();
    expect(copy.log).toEqual(['start']);

    await writeSettings({ ...DEFAULT_SETTINGS, outputCopy: false });
    expect(copy.log).toEqual(['start', 'stop']);
    expect(title.log).toEqual(['start']); // untouched

    await writeSettings({ ...DEFAULT_SETTINGS });
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
    await writeSettings({ ...DEFAULT_SETTINGS });
    teardown = bootstrap({ jsonEditor: flaky });
    await flush();
    const before = attempts;
    await writeSettings({ ...DEFAULT_SETTINGS, titleUpdater: false });
    expect(attempts).toBeGreaterThan(before);
  });

  test('the teardown stops every feature and the settings launcher', async () => {
    await writeSettings({ ...DEFAULT_SETTINGS });
    const copy = new RecordingFeature();
    const before = fakeChrome.runtime.onMessage.listeners.length;
    const stop = bootstrap({ outputCopy: copy });
    await flush();
    expect(fakeChrome.runtime.onMessage.listeners.length).toBe(before + 1); // the settings launcher

    stop();
    expect(copy.log).toEqual(['start', 'stop']);
    expect(fakeChrome.runtime.onMessage.listeners.length).toBe(before);
    await writeSettings({ ...DEFAULT_SETTINGS, outputCopy: false });
    await writeSettings({ ...DEFAULT_SETTINGS });
    expect(copy.log).toEqual(['start', 'stop']);
  });
});
