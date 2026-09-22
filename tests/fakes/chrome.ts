// An in-memory stand-in for the parts of the `chrome.*` extension API the code
// uses. Installed as `globalThis.chrome` by tests/setup.ts, before any source
// module is imported.
//
// It behaves like the real thing where the code depends on it: storage writes
// fire storage.onChanged with old/new values, both the callback and the
// promise form of storage.get work, and registered content scripts persist
// until unregistered. Anything a test needs to observe (messages sent, tabs
// opened) is recorded on the fake.

type Listener = (...args: any[]) => any;

export class FakeEvent {
  listeners: Listener[] = [];
  addListener(fn: Listener) { this.listeners.push(fn); }
  removeListener(fn: Listener) { this.listeners = this.listeners.filter((l) => l !== fn); }
  hasListener(fn: Listener) { return this.listeners.includes(fn); }
  /** Call every listener, returning their results. */
  dispatch(...args: any[]) { return this.listeners.map((l) => l(...args)); }
}

class FakeStorageArea {
  data = new Map<string, unknown>();
  constructor(private areaName: string, private onChanged: FakeEvent) {}

  get(keys?: string | string[] | null, callback?: (items: Record<string, unknown>) => void) {
    const wanted = keys == null ? [...this.data.keys()] : Array.isArray(keys) ? keys : [keys];
    const items: Record<string, unknown> = {};
    for (const key of wanted) {
      if (this.data.has(key)) items[key] = structuredClone(this.data.get(key));
    }
    if (callback) {
      queueMicrotask(() => callback(items));
      return undefined;
    }
    return Promise.resolve(items);
  }

  set(items: Record<string, unknown>, callback?: () => void) {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: this.data.get(key), newValue: structuredClone(value) };
      this.data.set(key, structuredClone(value));
    }
    this.onChanged.dispatch(changes, this.areaName);
    callback?.();
    return Promise.resolve();
  }

  remove(keys: string | string[], callback?: () => void) {
    const changes: Record<string, { oldValue?: unknown }> = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (!this.data.has(key)) continue;
      changes[key] = { oldValue: this.data.get(key) };
      this.data.delete(key);
    }
    if (Object.keys(changes).length) this.onChanged.dispatch(changes, this.areaName);
    callback?.();
    return Promise.resolve();
  }
}

interface RegisteredScript { id: string; matches: string[]; js: string[]; [key: string]: unknown }

function createFakeChrome() {
  const onChanged = new FakeEvent();
  const registered = new Map<string, RegisteredScript>();
  const granted = new Set<string>();

  const fake = {
    storage: {
      onChanged,
      local: new FakeStorageArea('local', onChanged),
      session: new FakeStorageArea('session', onChanged)
    },
    runtime: {
      id: 'test-extension',
      lastError: undefined as undefined | { message: string },
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      onMessage: new FakeEvent(),
      onInstalled: new FakeEvent(),
      onStartup: new FakeEvent(),
      sent: [] as unknown[],
      sendMessage(message: unknown, callback?: (response: unknown) => void) {
        fake.runtime.sent.push(message);
        callback?.(undefined);
      }
    },
    scripting: {
      registered,
      async getRegisteredContentScripts() { return [...registered.values()]; },
      async registerContentScripts(scripts: RegisteredScript[]) {
        for (const s of scripts) {
          if (registered.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
          registered.set(s.id, s);
        }
      },
      async updateContentScripts(scripts: RegisteredScript[]) {
        for (const s of scripts) registered.set(s.id, { ...registered.get(s.id), ...s });
      },
      async unregisterContentScripts({ ids }: { ids: string[] }) {
        for (const id of ids) registered.delete(id);
      }
    },
    permissions: {
      granted,
      onAdded: new FakeEvent(),
      onRemoved: new FakeEvent(),
      async contains({ origins }: { origins: string[] }) { return origins.every((o) => granted.has(o)); },
      async request({ origins }: { origins: string[] }) { origins.forEach((o) => granted.add(o)); return true; },
      async remove({ origins }: { origins: string[] }) { origins.forEach((o) => granted.delete(o)); return true; }
    },
    tabs: {
      created: [] as unknown[],
      create(props: unknown) { fake.tabs.created.push(props); },
      sendMessage(_tabId: number, _message: unknown, callback?: (r: unknown) => void) { callback?.(undefined); },
      query(_q: unknown, callback: (tabs: unknown[]) => void) { callback([]); }
    },
    commands: { onCommand: new FakeEvent() },
    devtools: {
      inspectedWindow: {
        tabId: 1,
        /** Replace per test: what `eval(expression)` returns. */
        evalHandler: (_expression: string): unknown => undefined,
        eval(expression: string, callback?: (result: unknown, error?: unknown) => void) {
          const result = fake.devtools.inspectedWindow.evalHandler(expression);
          queueMicrotask(() => callback?.(result, undefined));
        }
      },
      network: {
        onNavigated: new FakeEvent(),
        onRequestFinished: new FakeEvent(),
        getHAR(callback: (log: { entries: unknown[] }) => void) { callback({ entries: [] }); }
      },
      panels: { create(_t: string, _i: string, _p: string, cb?: () => void) { cb?.(); } }
    },

    /** Forget stored data and recorded calls. Listeners stay registered. */
    reset() {
      fake.storage.local.data.clear();
      fake.storage.session.data.clear();
      registered.clear();
      granted.clear();
      fake.runtime.sent.length = 0;
      fake.tabs.created.length = 0;
      fake.runtime.lastError = undefined;
      fake.devtools.inspectedWindow.evalHandler = () => undefined;
    }
  };
  return fake;
}

export type FakeChrome = ReturnType<typeof createFakeChrome>;
export const fakeChrome: FakeChrome = createFakeChrome();
