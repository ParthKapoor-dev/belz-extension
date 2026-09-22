import { beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../fakes/chrome';
import { HOSTS_STORAGE_KEY } from '../../src/config/storage-keys';
import {
  isHostsChange,
  normalizeHost,
  originPattern,
  readEnabledHosts,
  readHosts,
  writeHosts
} from '../../src/shared/hosts';

beforeEach(() => fakeChrome.reset());

describe('normalizeHost', () => {
  test.each([
    ['nsm-dev.example.com', 'nsm-dev.example.com'],
    ['  HTTPS://NSM-dev.Example.com/some/path?q=1 ', 'nsm-dev.example.com'],
    ['http://host.test:8080', 'host.test'],
    ['localhost', 'localhost']
  ])('%p -> %p', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });

  test.each(['', '   ', 'not a host', '-leading.dash', 'under_score.com', 'a..b'])(
    'rejects %p',
    (input) => {
      expect(normalizeHost(input)).toBeNull();
    }
  );
});

describe('host storage', () => {
  test('reads nothing from empty or malformed storage', async () => {
    expect(await readHosts()).toEqual([]);
    await fakeChrome.storage.local.set({ [HOSTS_STORAGE_KEY]: { hosts: 'nope' } });
    expect(await readHosts()).toEqual([]);
  });

  test('drops entries without a host, keeps order', async () => {
    await fakeChrome.storage.local.set({
      [HOSTS_STORAGE_KEY]: { hosts: [{ host: 'b.test' }, null, { enabled: true }, { host: 'a.test' }] }
    });
    expect((await readHosts()).map((h: any) => h.host)).toEqual(['b.test', 'a.test']);
  });

  test('enabled means "not explicitly disabled"', async () => {
    await writeHosts([
      { host: 'on.test', enabled: true },
      { host: 'legacy.test' },
      { host: 'off.test', enabled: false }
    ]);
    expect((await readEnabledHosts()).map((h: any) => h.host)).toEqual(['on.test', 'legacy.test']);
  });

  test('change detection only fires for the host key in local storage', () => {
    expect(isHostsChange({ [HOSTS_STORAGE_KEY]: {} }, 'local')).toBe(true);
    expect(isHostsChange({ [HOSTS_STORAGE_KEY]: {} }, 'session')).toBe(false);
    expect(isHostsChange({ other: {} }, 'local')).toBe(false);
  });

  test('origin pattern is https-only', () => {
    expect(originPattern('a.test')).toBe('https://a.test/*');
  });
});
