// An in-memory stand-in for the parts of the `chrome.*` extension API the code
// uses. Installed as `globalThis.chrome` by tests/setup.ts, before any source
// module is imported.
//
// It behaves like the real thing where the code depends on it:
//   - storage.onChanged fires asynchronously (a task after the write), and
//     only for keys whose value actually changed, with old/new values; both
//     the callback and the promise form of storage.get work;
//   - registerContentScripts answers asynchronously, is all-or-nothing, and
//     rejects a duplicate id ("Duplicate script ID"), so two overlapping
//     registrations of one id fail the way they do in the browser;
//   - registered content scripts persist until unregistered.
// Anything a test needs to observe (messages sent, tabs opened) is recorded on
// the fake.

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
      const had = this.data.has(key);
      const oldValue = this.data.get(key);
      this.data.set(key, structuredClone(value));
      // Like the browser: writing the value a key already has is no change.
      if (had && JSON.stringify(oldValue) === JSON.stringify(value)) continue;
      changes[key] = { oldValue, newValue: structuredClone(value) };
    }
    this.fire(changes);
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
    this.fire(changes);
    callback?.();
    return Promise.resolve();
  }

  /** Later (a task after the write settles), never inside set()/remove(). */
  private fire(changes: Record<string, unknown>) {
    if (!Object.keys(changes).length) return;
    setTimeout(() => this.onChanged.dispatch(changes, this.areaName), 0);
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
      /**
       * Replace per test: the answer the other end gives to a message (the
       * background relay, the page engine behind it). Undefined by default.
       * A promise is waited for, as the browser waits for an async answer.
       */
      respond: (_message: unknown): unknown => undefined,
      sendMessage(message: unknown, callback?: (response: unknown) => void) {
        fake.runtime.sent.push(message);
        const response = Promise.resolve(fake.runtime.respond(message));
        if (callback) void response.then((r) => callback(r));
        return response;
      }
    },
    scripting: {
      registered,
      async getRegisteredContentScripts() { return [...registered.values()]; },
      /** All or nothing; a duplicate id (registered, or twice in the call) rejects it all. */
      async registerContentScripts(scripts: RegisteredScript[]) {
        await Promise.resolve(); // the browser answers later: calls can interleave
        const ids = new Set<string>();
        for (const s of scripts) {
          if (registered.has(s.id) || ids.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
          ids.add(s.id);
        }
        for (const s of scripts) registered.set(s.id, s);
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
      /** Set false to have the user deny the next requests. */
      allowRequest: true,
      /** Set false to have the browser refuse removals. */
      allowRemove: true,
      /** Every origin list passed to request(), in order. */
      requested: [] as string[][],
      async contains({ origins }: { origins: string[] }) { return origins.every((o) => granted.has(o)); },
      async request({ origins }: { origins: string[] }) {
        fake.permissions.requested.push(origins);
        if (!fake.permissions.allowRequest) return false;
        origins.forEach((o) => granted.add(o));
        return true;
      },
      async remove({ origins }: { origins: string[] }) {
        if (!fake.permissions.allowRemove) return false;
        origins.forEach((o) => granted.delete(o));
        return true;
      }
    },
    tabs: {
      created: [] as unknown[],
      /** Every tabs.sendMessage, as [tabId, message]. */
      messages: [] as [number, unknown][],
      /** Replace per test: what a tab's content script answers. */
      respond: (_tabId: number, _message: unknown): unknown => undefined,
      /** Replace per test: the tabs tabs.query finds. */
      queryResult: [] as unknown[],
      async create(props: unknown) { fake.tabs.created.push(props); return props; },
      sendMessage(tabId: number, message: unknown, callback?: (r: unknown) => void) {
        fake.tabs.messages.push([tabId, message]);
        const response = fake.tabs.respond(tabId, message);
        queueMicrotask(() => callback?.(response));
      },
      query(_q: unknown, callback: (tabs: unknown[]) => void) { callback(fake.tabs.queryResult); }
    },
    commands: { onCommand: new FakeEvent() },
    devtools: {
      inspectedWindow: {
        tabId: 1,
        /** Replace per test: what `eval(expression)` returns. */
        evalHandler: (_expression: string): unknown => undefined,
        /** Every expression evaluated, in order. */
        evaluated: [] as string[],
        eval(expression: string, callback?: (result: unknown, error?: unknown) => void) {
          fake.devtools.inspectedWindow.evaluated.push(expression);
          const result = fake.devtools.inspectedWindow.evalHandler(expression);
          queueMicrotask(() => callback?.(result, undefined));
        }
      },
      network: {
        onNavigated: new FakeEvent(),
        onRequestFinished: new FakeEvent(),
        getHAR(callback: (log: { entries: unknown[] }) => void) { callback({ entries: [] }); }
      },
      panels: {
        /** Every panel created, as `[title, page]`. */
        created: [] as [string, string][],
        create(title: string, _icon: string, page: string, cb?: () => void) {
          fake.devtools.panels.created.push([title, page]);
          cb?.();
        }
      }
    },

    /** Forget stored data and recorded calls. Listeners stay registered. */
    reset() {
      fake.storage.local.data.clear();
      fake.storage.session.data.clear();
      registered.clear();
      granted.clear();
      fake.runtime.sent.length = 0;
      fake.runtime.respond = () => undefined;
      fake.tabs.created.length = 0;
      fake.tabs.messages.length = 0;
      fake.tabs.respond = () => undefined;
      fake.tabs.queryResult = [];
      fake.runtime.lastError = undefined;
      fake.permissions.allowRequest = true;
      fake.permissions.allowRemove = true;
      fake.permissions.requested.length = 0;
      fake.devtools.panels.created.length = 0;
      fake.devtools.inspectedWindow.evalHandler = () => undefined;
      fake.devtools.inspectedWindow.evaluated.length = 0;
    }
  };
  return fake;
}

export type FakeChrome = ReturnType<typeof createFakeChrome>;
export const fakeChrome: FakeChrome = createFakeChrome();

/** A message sender the extension's own pages would have: this extension, no tab. */
export const extensionPageSender = { id: 'test-extension', url: 'chrome-extension://test-extension/panel-pd.html' };

/** A message sender for this extension's content script in tab `tabId` at `url`. */
export function contentScriptSender(url: string, tabId = 1) {
  return { id: 'test-extension', url, tab: { id: tabId } };
}
