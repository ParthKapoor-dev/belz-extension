import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeChrome } from '../fakes/chrome';
import { AdNetworkPanel } from '../../src/devtools/ad-network/network-panel';
import type { HarEntry } from '../../src/devtools/ad-network/types';

// Drives the real AD Network panel over its real markup (panel.html), feeding
// it HAR entries the way chrome.devtools.network does. Assertions read text
// and counts only (see tests/memory-guard-worker.ts).

const ORIGIN = 'https://nsm.test';
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UUID_A = 'a'.repeat(32);
const UUID_B = 'b'.repeat(32);

function har(uuid: string, opts: { at?: string; execute?: boolean; body?: string; content?: string } = {}): HarEntry {
  const path = opts.execute ? `chain/execute/${uuid}` : `chain/v2/${uuid}`;
  const entry = {
    startedDateTime: opts.at ?? '2026-01-01T10:00:00.000Z',
    time: 42,
    request: {
      method: opts.execute ? 'POST' : 'GET',
      url: `${ORIGIN}/rest/api/automation/${path}`,
      headers: [{ name: 'Authorization', value: 'Bearer t' }],
      queryString: [],
      postData: opts.body ? { mimeType: 'application/json', text: opts.body } : undefined
    },
    response: {
      status: 200,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      content: { size: 10, mimeType: 'application/json', text: opts.content }
    },
    timings: { send: 1, wait: 30, receive: 11 }
  };
  return entry as unknown as HarEntry;
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('#rows tr')];
const visibleRows = () => rows().filter((r) => !r.classList.contains('hidden'));
const cellText = (row: HTMLTableRowElement, i: number) => row.children[i]!.textContent;
const send = (entry: HarEntry) => fakeChrome.devtools.network.onRequestFinished.dispatch(entry);

let panel: AdNetworkPanel;

beforeAll(() => {
  const html = readFileSync(join(import.meta.dir, '../../src/devtools/ad-network/panel.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*><\/script>/g, '');
  document.body.innerHTML = body;
  fakeChrome.devtools.inspectedWindow.evalHandler = (expr) => (expr === 'location.origin' ? ORIGIN : null);
  // The platform knows every method as "Resolved" in "Cat".
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ name: 'Resolved', metadata: { service: { name: 'Cat' }, state: 'DRAFT' } })
  })) as unknown as typeof fetch;
  panel = new AdNetworkPanel();
  panel.start();
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  $('#clear').click();
  if ($<HTMLInputElement>('#filter').value) {
    $<HTMLInputElement>('#filter').value = '';
    $('#filter').dispatchEvent(new Event('input'));
  }
});

describe('AD Network panel', () => {
  test('a chain request becomes a row; other requests are ignored', () => {
    send(har(UUID_A));
    const other = har(UUID_A, { at: '2026-01-01T10:00:01.000Z' });
    (other.request as { url: string }).url = `${ORIGIN}/api/unrelated`;
    send(other);
    expect(rows().length).toBe(1);
    expect($('#count').textContent).toBe('1');
    expect($('#empty').classList.contains('hidden')).toBe(true);
  });

  test('the same request seen twice, with differently formatted times, is one row', () => {
    send(har(UUID_A, { at: '2026-01-01T10:00:00.000Z' }));
    send(har(UUID_A, { at: '2026-01-01T15:30:00.000+05:30' }));
    expect(rows().length).toBe(1);
  });

  test('rows are ordered by start time, whatever order they arrive in', () => {
    send(har(UUID_B, { at: '2026-01-01T10:00:05.000Z' }));
    send(har(UUID_A, { at: '2026-01-01T10:00:01.000Z' }));
    expect(rows().map((r) => cellText(r, 7))).toEqual([UUID_A, UUID_B]);
    expect(rows().map((r) => cellText(r, 0))).toEqual(['1', '2']);
  });

  test('names and categories are resolved from the platform', async () => {
    send(har(UUID_A, { execute: true }));
    expect(cellText(rows()[0]!, 1)).toContain('…'); // still resolving
    await sleep(400); // resolve debounce + request
    expect(cellText(rows()[0]!, 1)).toBe('Resolved');
    expect(cellText(rows()[0]!, 2)).toBe('Cat');
  });

  test('the filter hides rows that do not match', () => {
    send(har(UUID_A, { at: '2026-01-01T10:00:01.000Z' }));
    send(har(UUID_B, { at: '2026-01-01T10:00:02.000Z' }));
    const filter = $<HTMLInputElement>('#filter');
    filter.value = 'bbbb';
    filter.dispatchEvent(new Event('input'));
    expect(visibleRows().map((r) => cellText(r, 7))).toEqual([UUID_B]);
  });

  test('clicking a row opens its details; tabs switch; close hides them', () => {
    send(har(UUID_A, { execute: true, body: '{"x":1}', content: '{"ok":true}' }));
    rows()[0]!.click();
    expect($('#detail').classList.contains('hidden')).toBe(false);
    expect($('#detail-body').textContent).toContain(UUID_A);
    expect(rows()[0]!.classList.contains('selected')).toBe(true);

    $('.detail-tabs button[data-tab="payload"]').click();
    expect($('#detail-body').textContent).toContain('Request payload');
    $('.detail-tabs button[data-tab="response"]').click();
    expect($('#detail-body').textContent).toContain('Response body');
    $('.detail-tabs button[data-tab="headers"]').click();

    $('#detail-close').click();
    expect($('#detail').classList.contains('hidden')).toBe(true);
    expect(rows()[0]!.classList.contains('selected')).toBe(false);
  });

  test('pausing stops capture; Clear empties the table', () => {
    $('#record').click(); // pause
    send(har(UUID_A));
    expect(rows().length).toBe(0);
    $('#record').click(); // resume
    send(har(UUID_A));
    expect(rows().length).toBe(1);
    $('#clear').click();
    expect(rows().length).toBe(0);
    expect($('#count').textContent).toBe('0');
  });
});
