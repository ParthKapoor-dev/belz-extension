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
