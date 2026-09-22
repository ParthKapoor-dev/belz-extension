import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fakeChrome } from '../fakes/chrome';
import { SETTINGS_STORAGE_KEY } from '../../src/config/storage-keys';
import { createLogger } from '../../src/shared/logger';

const setDebug = (on: boolean) =>
  fakeChrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: { debugLogging: on } });

describe('createLogger', () => {
  const spies = {
    debug: spyOn(console, 'debug'),
    info: spyOn(console, 'info'),
    warn: spyOn(console, 'warn'),
    error: spyOn(console, 'error')
  };
  beforeEach(() => {
    for (const spy of Object.values(spies)) spy.mockImplementation(() => {});
  });
  afterEach(() => {
    for (const spy of Object.values(spies)) spy.mockReset();
    setDebug(false);
  });

  test('warnings and errors always print, with the scope', () => {
    setDebug(false);
    const log = createLogger('unit');
    log.warn('careful', 1);
    log.error('broken');
    expect(spies.warn.mock.calls[0]).toEqual(['[belz:unit]', 'careful', 1]);
    expect(spies.error.mock.calls[0]).toEqual(['[belz:unit]', 'broken']);
  });

  test('debug and info print only while Debug Logging is on', () => {
    const log = createLogger('unit');
    setDebug(false);
    log.debug('hidden');
    log.info('hidden');
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();

    setDebug(true);
    log.debug('shown');
    log.info('shown too');
    expect(spies.debug.mock.calls[0]).toEqual(['[belz:unit]', 'shown']);
    expect(spies.info.mock.calls[0]).toEqual(['[belz:unit]', 'shown too']);
  });
});

describe('console use', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
    });
  }

  test('only the logger writes to the console', () => {
    const src = join(import.meta.dir, '../../src');
    const offenders = sourceFiles(src)
      .filter((file) => !file.endsWith(join('shared', 'logger.ts')))
      .filter((file) => /\bconsole\.\w+\(/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(src.length + 1));
    expect(offenders).toEqual([]);
  });
});
