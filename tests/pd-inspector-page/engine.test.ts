import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../fakes/chrome';
import { PdEngine } from '../../src/pd-inspector-page/engine';
import { Highlighter } from '../../src/pd-inspector-page/highlight';
import { ns } from '../../src/config/namespace';
import type { EngineState } from '../../src/pd-inspector-page/types';

// Lifecycle of the PD Inspector's page side: PdEngine and its Highlighter.
// start()/stop() are idempotent and undo every listener; a build that a
// route change overtook never overwrites the newer state. Config fetches are
// stubbed to fail (the model itself is covered by model.test.ts).

const HIGHLIGHT_ID = ns('PdInspectorHighlight');
const START_URL = location.href;
const realFetch = globalThis.fetch;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/**
 * Counts live listeners added through `target.addEventListener`, per type,
 * by wrapping add/remove for the duration of a test. Like the DOM, a listener
 * is identified by (type, function, capture), so a duplicate add or a remove
 * of something never added changes nothing.
 */
function trackListeners(target: EventTarget) {
  const live: { type: string; fn: unknown; capture: boolean }[] = [];
  const capture = (opts: unknown) => (typeof opts === 'boolean' ? opts : Boolean((opts as { capture?: boolean })?.capture));
  const find = (type: string, fn: unknown, opts: unknown) =>
    live.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture(opts));
  const add = target.addEventListener;
  const remove = target.removeEventListener;
  target.addEventListener = function (this: EventTarget, type: string, fn: unknown, opts?: unknown) {
    if (find(type, fn, opts) === -1) live.push({ type, fn, capture: capture(opts) });
    return (add as any).call(this, type, fn, opts);
  } as typeof add;
  target.removeEventListener = function (this: EventTarget, type: string, fn: unknown, opts?: unknown) {
    const i = find(type, fn, opts);
    if (i !== -1) live.splice(i, 1);
    return (remove as any).call(this, type, fn, opts);
  } as typeof remove;
  return {
    count: (type: string) => live.filter((l) => l.type === type).length,
    restore: () => {
      target.addEventListener = add;
      target.removeEventListener = remove;
    }
  };
}

/** Ask the engine for its state the way the panel's relay does. */
function getState(): EngineState | undefined {
  let answer: EngineState | undefined;
  fakeChrome.runtime.onMessage.dispatch({ ns: 'pd', cmd: 'getState' }, {}, (r: EngineState) => {
    answer = r;
  });
  return answer;
}

let windowListeners: ReturnType<typeof trackListeners>;
let documentListeners: ReturnType<typeof trackListeners>;
beforeAll(() => {
  // Every config fetch fails fast unless a test holds it with a gate.
  globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  history.replaceState(null, '', START_URL);
});
beforeEach(() => {
  fakeChrome.reset();
  windowListeners = trackListeners(window);
  documentListeners = trackListeners(document);
});
afterEach(() => {
  windowListeners.restore();
  documentListeners.restore();
  history.replaceState(null, '', START_URL);
});

describe('Highlighter', () => {
  test('touches nothing on the page until start() and show()', () => {
    const h = new Highlighter();
    h.show([document.body], 'title');
    expect(document.getElementById(HIGHLIGHT_ID) === null).toBe(true);
    expect(windowListeners.count('scroll')).toBe(0);
    h.stop();
  });

  test('start() twice listens once; show() mounts; stop() twice unmounts and unlistens', () => {
    const h = new Highlighter();
    h.start();
    h.start();
    expect([windowListeners.count('scroll'), windowListeners.count('resize')]).toEqual([1, 1]);
    h.show([document.body], 'title', 'sub');
    expect(document.getElementById(HIGHLIGHT_ID) === null).toBe(false);
    h.stop();
    h.stop();
    expect([windowListeners.count('scroll'), windowListeners.count('resize')]).toEqual([0, 0]);
    expect(document.getElementById(HIGHLIGHT_ID) === null).toBe(true);
  });
});

describe('PdEngine', () => {
  test('start() off a published page does nothing', () => {
    const engine = new PdEngine();
    engine.start();
    expect(fakeChrome.runtime.onMessage.listeners.length).toBe(0);
    expect(windowListeners.count('scroll')).toBe(0);
    engine.stop();
  });

  test('start() twice wires once; stop() twice removes every listener and the route poll', async () => {
    history.replaceState(null, '', '/pages/app/home');
    const engine = new PdEngine();
    engine.start();
    engine.start();
    expect(fakeChrome.runtime.onMessage.listeners.length).toBe(1);
    expect(windowListeners.count('scroll')).toBe(1);

    // Inspect mode adds document listeners; stop() must take them off too.
    fakeChrome.runtime.onMessage.dispatch({ ns: 'pd', cmd: 'setInspect', on: true }, {}, () => {});
    expect([documentListeners.count('mousemove'), documentListeners.count('click')]).toEqual([1, 1]);

    engine.stop();
    engine.stop();
    expect(fakeChrome.runtime.onMessage.listeners.length).toBe(0);
    expect(windowListeners.count('scroll')).toBe(0);
    expect([documentListeners.count('mousemove'), documentListeners.count('click')]).toEqual([0, 0]);
    expect((engine as unknown as { routeTimer: unknown }).routeTimer === null).toBe(true);
    await flush();
  });

  test('a failed build reports an error state', async () => {
    history.replaceState(null, '', '/pages/app/home');
    const engine = new PdEngine();
    engine.start();
    expect(getState()?.status).toBe('loading');
    await flush();
    const state = getState();
    expect(state?.status).toBe('error');
    engine.stop();
  });

  test('a build overtaken by a route change never overwrites the newer state', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    globalThis.fetch = (async () => {
      await gate;
      return { ok: false, status: 500, json: async () => ({}) };
    }) as unknown as typeof fetch;
    try {
      history.replaceState(null, '', '/pages/app/home');
      const engine = new PdEngine();
      engine.start();
      expect(getState()?.status).toBe('loading');

      // The SPA leaves the published page while the build is in flight.
      history.replaceState(null, '', '/somewhere/else');
      (engine as unknown as { checkRoute: () => void }).checkRoute();
      expect(fakeChrome.runtime.sent).toEqual([{ ns: 'pd', type: 'routeChanged' }]);
      const after = getState();
      expect(after?.status === 'error' && after.error).toContain('not a published page');

      release();
      await flush();
      const still = getState();
      expect(still?.status === 'error' && still.error).toContain('not a published page');
      engine.stop();
    } finally {
      globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    }
  });

  test('stop() drops an in-flight build', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    globalThis.fetch = (async () => {
      await gate;
      return { ok: false, status: 500, json: async () => ({}) };
    }) as unknown as typeof fetch;
    try {
      history.replaceState(null, '', '/pages/app/home');
      const engine = new PdEngine();
      engine.start();
      engine.stop();
      release();
      await flush();
      expect((engine as unknown as { state: EngineState }).state.status).toBe('loading');
    } finally {
      globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    }
  });
});
