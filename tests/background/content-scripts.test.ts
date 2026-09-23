import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../fakes/chrome';
import { HOSTS_STORAGE_KEY } from '../../src/config/storage-keys';
import { hostPattern, readHosts, writeHosts } from '../../src/shared/hosts';
import {
  ContentScriptSync,
  reconcileContentScripts,
  scriptForHost,
  CONTENT_SCRIPT_TEMPLATES,
  seedHostsIfEmpty
} from '../../src/background/content-scripts';
import { waitFor } from '../wait';

const ids = () => [...fakeChrome.scripting.registered.keys()].sort();
const realFetch = globalThis.fetch;

beforeEach(() => fakeChrome.reset());
afterEach(() => { globalThis.fetch = realFetch; });

describe('ContentScriptSync', () => {
  let sync: ContentScriptSync;
  let errors: unknown[];
  const onRejection = (event: unknown) => errors.push(event);
  beforeEach(() => {
    sync = new ContentScriptSync();
    errors = [];
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    sync.stop();
    process.off('unhandledRejection', onRejection);
  });

  test('reconciles started together never register one id twice', async () => {
    await writeHosts([{ host: 'a.test', enabled: true }]);
    // Unserialised, both passes would see nothing registered and both
    // register: the second one fails with "Duplicate script ID".
    const direct = await Promise.allSettled([reconcileContentScripts(), reconcileContentScripts()]);
    expect(direct.every((r) => r.status === 'fulfilled')).toBe(true); // handled, not thrown

    fakeChrome.reset();
    await writeHosts([{ host: 'a.test', enabled: true }]);
    const scriptingErrors: unknown[] = [];
    const register = fakeChrome.scripting.registerContentScripts;
    fakeChrome.scripting.registerContentScripts = async (scripts) => {
      try {
        return await register(scripts);
      } catch (err) {
        scriptingErrors.push(err);
        throw err;
      }
    };
    try {
      await Promise.all([sync.reconcile(), sync.reconcile(), sync.reconcile()]);
    } finally {
      fakeChrome.scripting.registerContentScripts = register;
    }
    expect(ids()).toEqual(['ad-a.test', 'pd-a.test', 'pdi-a.test']);
    expect(scriptingErrors).toEqual([]);
  });

  test('requests made while a pass runs are coalesced into one more pass, which reads the latest list', async () => {
    await writeHosts([{ host: 'a.test', enabled: true }]);
    let passes = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const getRegistered = fakeChrome.scripting.getRegisteredContentScripts;
    fakeChrome.scripting.getRegisteredContentScripts = async () => {
      passes++;
      if (passes === 1) await gate; // hold the first pass while more requests arrive
      return getRegistered();
    };
    try {
      const first = sync.reconcile();
      await waitFor(() => passes === 1, 'the first pass to start');
      const queued = [sync.reconcile(), sync.reconcile(), sync.reconcile()];
      await writeHosts([{ host: 'b.test', enabled: true }]);
      release();
      await Promise.all([first, ...queued]);
    } finally {
      fakeChrome.scripting.getRegisteredContentScripts = getRegistered;
    }
    expect(passes).toBe(2); // the running pass, then one for everything queued behind it
    expect(ids()).toEqual(['ad-b.test', 'pd-b.test', 'pdi-b.test']);
  });

  test('a change to the host list reconciles, and a failing step is logged, not left unhandled', async () => {
    const unregister = fakeChrome.scripting.unregisterContentScripts;
    fakeChrome.scripting.unregisterContentScripts = (async () => { throw new Error('boom'); }) as any;
    try {
      sync.start();
      await writeHosts([{ host: 'a.test', enabled: true }]);
      await waitFor(() => ids().length === 3, 'the registrations');
      fakeChrome.scripting.registered.set('stale-x.test', { id: 'stale-x.test', matches: [], js: [] });
      await writeHosts([{ host: 'a.test', enabled: true }, { host: 'c.test', enabled: true }]);
      await waitFor(() => ids().length === 7, 'the second host, despite the failing unregister');
    } finally {
      fakeChrome.scripting.unregisterContentScripts = unregister;
    }
    expect(errors).toEqual([]);
  });

  test('a script registered behind our back is updated rather than failing the pass', async () => {
    await writeHosts([{ host: 'a.test', enabled: true }]);
    const getRegistered = fakeChrome.scripting.getRegisteredContentScripts;
    // A stale view: the list says nothing is registered, but one id already is.
    const [ad] = CONTENT_SCRIPT_TEMPLATES;
    fakeChrome.scripting.registered.set('ad-a.test', { ...scriptForHost('a.test', ad!), js: ['old.js'] } as any);
    fakeChrome.scripting.getRegisteredContentScripts = async () => [];
    try {
      await sync.reconcile();
    } finally {
      fakeChrome.scripting.getRegisteredContentScripts = getRegistered;
    }
    expect(ids()).toEqual(['ad-a.test', 'pd-a.test', 'pdi-a.test']);
    expect(fakeChrome.scripting.registered.get('ad-a.test')!.js).toEqual(['dist/ad-content.js']);
  });

  test('a permission removed outside the options page unmarks the host and unregisters its scripts', async () => {
    await writeHosts([{ host: 'a.test', enabled: true }, { host: 'b.test', enabled: true }]);
    fakeChrome.permissions.granted.add(hostPattern('a.test'));
    fakeChrome.permissions.granted.add(hostPattern('b.test'));
    sync.start();
    await sync.reconcile();
    expect(ids()).toHaveLength(6);

    fakeChrome.permissions.granted.delete(hostPattern('b.test'));
    fakeChrome.permissions.onRemoved.dispatch({ origins: [hostPattern('b.test')] });
    await waitFor(() => ids().length === 3, 'b.test to be unregistered');
    expect(ids()).toEqual(['ad-a.test', 'pd-a.test', 'pdi-a.test']);
    expect((await readHosts()).map((h) => [h.host, h.enabled])).toEqual([['a.test', true], ['b.test', false]]);
  });

  test('a permission granted outside the options page marks the host and registers its scripts', async () => {
    await writeHosts([{ host: 'a.test', enabled: false, seeded: true }]);
    sync.start();
    fakeChrome.permissions.granted.add(hostPattern('a.test'));
    fakeChrome.permissions.onAdded.dispatch({ origins: [hostPattern('a.test')] });
    await waitFor(() => ids().length === 3, 'a.test to be registered');
    expect(await readHosts()).toEqual([{ host: 'a.test', enabled: true }]);
  });
});

describe('reconcileContentScripts', () => {
  test('registers AD, PD and PD Inspector scripts per enabled host', async () => {
    await writeHosts([{ host: 'a.test', enabled: true }, { host: 'off.test', enabled: false }]);
    await reconcileContentScripts();

    expect(ids()).toEqual(['ad-a.test', 'pd-a.test', 'pdi-a.test']);
    const ad = fakeChrome.scripting.registered.get('ad-a.test')!;
    expect(ad.matches).toEqual(['https://a.test/automation-designer/*']);
    expect(ad.js).toEqual(['dist/ad-content.js']);
    expect(fakeChrome.scripting.registered.get('pdi-a.test')!.js).toEqual(['dist/pd-inspector.js']);
  });

  test('removes scripts for hosts that left the list, keeps the rest', async () => {
    await writeHosts([{ host: 'a.test', enabled: true }, { host: 'b.test', enabled: true }]);
    await reconcileContentScripts();
    await writeHosts([{ host: 'b.test', enabled: true }]);
    await reconcileContentScripts();
    expect(ids()).toEqual(['ad-b.test', 'pd-b.test', 'pdi-b.test']);
  });

  test('is idempotent', async () => {
    await writeHosts([{ host: 'a.test', enabled: true }]);
    await reconcileContentScripts();
    await reconcileContentScripts();
    expect(ids()).toHaveLength(3);
  });
});

describe('seedHostsIfEmpty', () => {
  function serveSeed(body: unknown, ok = true) {
    globalThis.fetch = (async () => ({ ok, json: async () => body })) as any;
  }

  test('restores the list from sites.default.json, ungranted', async () => {
    serveSeed({ hosts: [{ host: ' A.Test ', designerHost: 'Staff.Test' }, { host: '' }, {}] });
    await seedHostsIfEmpty();
    expect(fakeChrome.storage.local.data.get(HOSTS_STORAGE_KEY)).toEqual({
      hosts: [{ host: 'a.test', enabled: false, seeded: true, designerHost: 'staff.test' }]
    });
  });

  test('seeded hosts are normalised like typed ones, and invalid ones dropped', async () => {
    serveSeed({ hosts: [
      { host: 'https://B.Test:8443/automation-designer/', designerHost: 'https://Staff.B.Test/x' },
      { host: 'not a host!' },
      { host: 42 }
    ] });
    await seedHostsIfEmpty();
    expect(fakeChrome.storage.local.data.get(HOSTS_STORAGE_KEY)).toEqual({
      hosts: [{ host: 'b.test', enabled: false, seeded: true, designerHost: 'staff.b.test' }]
    });
  });

  test('never overwrites a list the user emptied on purpose', async () => {
    await writeHosts([]);
    serveSeed({ hosts: [{ host: 'a.test', enabled: true }] });
    await seedHostsIfEmpty();
    expect(fakeChrome.storage.local.data.get(HOSTS_STORAGE_KEY)).toEqual({ hosts: [] });
  });

  test('a missing seed file leaves storage empty', async () => {
    serveSeed(null, false);
    await seedHostsIfEmpty();
    expect(fakeChrome.storage.local.data.has(HOSTS_STORAGE_KEY)).toBe(false);
  });
});
