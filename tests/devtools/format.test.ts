import { describe, expect, test } from 'bun:test';
import {
  buildCurl,
  formatBytes,
  harKey,
  prettyMaybeJson,
  shortUuidFromUrl,
  startedAt,
  statusGroup
} from '../../src/devtools/ad-network/format';
import type { HarEntry } from '../../src/devtools/ad-network/types';

const entry = (fields: Record<string, unknown>) => fields as unknown as HarEntry;

describe('AD Network formatting', () => {
  test('statusGroup buckets statuses; 0 means the request did not complete', () => {
    expect([200, 304, 404, 500, 0].map(statusGroup)).toEqual(['ok', 'redir', 'clienterr', 'srverr', 'error']);
  });

  test('formatBytes', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 kB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });

  test('start times with different offsets compare as instants', () => {
    const a = entry({ startedDateTime: '2026-01-01T12:34:57+00:00', request: { url: 'u' } });
    const b = entry({ startedDateTime: '2026-01-01T17:04:56+05:30', request: { url: 'u' } });
    expect(startedAt(a) > startedAt(b)).toBe(true);
    const sameInstant = entry({ startedDateTime: '2026-01-01T18:04:57+05:30', request: { url: 'u' } });
    expect(harKey(a)).toBe(harKey(sameInstant));
  });

  test('buildCurl quotes safely and skips pseudo-headers', () => {
    const curl = buildCurl(entry({
      request: {
        url: "https://h/x?q='1'",
        method: 'POST',
        headers: [{ name: ':authority', value: 'h' }, { name: 'X-A', value: 'b' }],
        postData: { text: '{"a":1}' }
      }
    }));
    expect(curl).toContain(`curl 'https://h/x?q='\\''1'\\'''`);
    expect(curl).toContain('-X POST');
    expect(curl).toContain(`-H 'X-A: b'`);
    expect(curl).not.toContain(':authority');
    expect(curl).toContain(`--data-raw '{"a":1}'`);
  });

  test('prettyMaybeJson and shortUuidFromUrl', () => {
    expect(prettyMaybeJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyMaybeJson('not json')).toBe('not json');
    expect(shortUuidFromUrl(`/chain/${'c'.repeat(32)}`)).toBe('cccccccccccc…');
    expect(shortUuidFromUrl('/nothing')).toBeNull();
  });
});
