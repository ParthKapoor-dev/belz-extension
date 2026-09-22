import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../fakes/chrome';
import { HOSTS_STORAGE_KEY } from '../../src/config/storage-keys';
import { writeHosts } from '../../src/shared/hosts';
import {
  reconcileContentScripts,
  seedHostsIfEmpty
} from '../../src/background/content-scripts';

const ids = () => [...fakeChrome.scripting.registered.keys()].sort();
const realFetch = globalThis.fetch;

beforeEach(() => fakeChrome.reset());
afterEach(() => { globalThis.fetch = realFetch; });

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
