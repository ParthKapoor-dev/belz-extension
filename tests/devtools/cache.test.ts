import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { clear, read, size, write } from '../../src/devtools/ad-network/cache';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = new Date('2026-01-01T00:00:00Z');

beforeEach(async () => {
  await clear();
  setSystemTime(START);
});
afterEach(() => setSystemTime());

const later = (ms: number) => setSystemTime(new Date(START.getTime() + ms));

describe('AD method cache', () => {
  test('fresh for 6 hours', () => {
    write('o', 'u', { name: 'n', category: 'c' });
    later(5 * HOUR);
    expect(read('o', 'u')).toMatchObject({ stale: false, data: { name: 'n', category: 'c' } });
  });

  test('stale but served until 14 days', () => {
    write('o', 'u', { name: 'n' });
    later(7 * HOUR);
    expect(read('o', 'u')?.stale).toBe(true);
    later(13 * DAY);
    expect(read('o', 'u')?.stale).toBe(true);
  });

  test('gone after 14 days', () => {
    write('o', 'u', { name: 'n' });
    later(15 * DAY);
    expect(read('o', 'u')).toBeNull();
  });

  test('keyed per origin, so environments never collide', () => {
    write('https://dev', 'u', { name: 'dev-name' });
    expect(read('https://qa', 'u')).toBeNull();
  });

  test('an empty summary is not stored', () => {
    write('o', 'u', { state: 'DRAFT' });
    expect(read('o', 'u')).toBeNull();
    expect(size()).toBe(0);
  });
});
