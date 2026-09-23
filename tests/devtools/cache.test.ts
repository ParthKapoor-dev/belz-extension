import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { MethodCache } from '../../src/devtools/ad-network/cache';

let cache: MethodCache;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = new Date('2026-01-01T00:00:00Z');

beforeEach(async () => {
  cache = new MethodCache();
  await cache.clear();
  setSystemTime(START);
});
afterEach(() => setSystemTime());

const later = (ms: number) => setSystemTime(new Date(START.getTime() + ms));

describe('AD method cache', () => {
  test('fresh for 6 hours', () => {
    cache.write('o', 'u', { name: 'n', category: 'c' });
    later(5 * HOUR);
    expect(cache.read('o', 'u')).toMatchObject({ stale: false, data: { name: 'n', category: 'c' } });
  });

  test('stale but served until 14 days', () => {
    cache.write('o', 'u', { name: 'n' });
    later(7 * HOUR);
    expect(cache.read('o', 'u')?.stale).toBe(true);
    later(13 * DAY);
    expect(cache.read('o', 'u')?.stale).toBe(true);
  });

  test('gone after 14 days', () => {
    cache.write('o', 'u', { name: 'n' });
    later(15 * DAY);
    expect(cache.read('o', 'u')).toBeNull();
  });

  test('keyed per origin, so environments never collide', () => {
    cache.write('https://dev', 'u', { name: 'dev-name' });
    expect(cache.read('https://qa', 'u')).toBeNull();
  });

  test('an empty summary is not stored', () => {
    cache.write('o', 'u', { state: 'DRAFT' });
    expect(cache.read('o', 'u')).toBeNull();
    expect(cache.size).toBe(0);
  });
});

describe('two DevTools windows sharing the stored cache', () => {
  test('each window\'s entries survive the other\'s writes', async () => {
    const a = new MethodCache();
    const b = new MethodCache();
    await Promise.all([a.hydrate(), b.hydrate()]);
    a.write('o', 'from-a', { name: 'A' });
    b.write('o', 'from-b', { name: 'B' });
    await a.flush();
    await b.flush(); // written after a: must not drop a's entry

    const reopened = new MethodCache();
    await reopened.hydrate();
    expect([reopened.read('o', 'from-a')?.data.name, reopened.read('o', 'from-b')?.data.name]).toEqual(['A', 'B']);
    // And b learned a's entry when it flushed.
    expect(b.read('o', 'from-a')?.data.name).toBe('A');
  });

  test('the newer write of one entry wins', async () => {
    const a = new MethodCache();
    const b = new MethodCache();
    await Promise.all([a.hydrate(), b.hydrate()]);
    a.write('o', 'u', { name: 'old' });
    later(HOUR);
    b.write('o', 'u', { name: 'new' });
    await b.flush();
    await a.flush(); // a's entry is older: it does not overwrite b's
    const reopened = new MethodCache();
    await reopened.hydrate();
    expect(reopened.read('o', 'u')?.data.name).toBe('new');
  });
});
