import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeChrome } from '../fakes/chrome';
import { AdNetworkPanel } from '../../src/devtools/ad-network/network-panel';
import { UNINSTALL_SCRIPT, WRAPPER_SCRIPT } from '../../src/devtools/ad-network/pending-capture';
import { AUTOFILL_FRAGMENT_PARAM } from '../../src/config/namespace';
import { AD_CACHE_STORAGE_KEY, AUTOFILL_HANDOFF_KEY_PREFIX } from '../../src/config/storage-keys';
import { writeHosts } from '../../src/shared/hosts';
import type { HarEntry } from '../../src/devtools/ad-network/types';
import { sleep, waitFor } from '../wait';

// Drives the real AD Network panel over its real markup (panel.html), feeding
// it HAR entries the way chrome.devtools.network does. Assertions read text
// and counts only (see tests/memory-guard-worker.ts).

const ORIGIN = 'https://nsm.test';
const realFetch = globalThis.fetch;
/** The origin the inspected page is on; tests navigate it. */
let inspected = ORIGIN;
/** Every lookup the panel made: the URL, and the Authorization header it sent. */
let fetches: Array<{ url: string; auth: string | undefined }> = [];
/** Set to hold the platform's answers until the test calls it. */
let holdFetches: Promise<void> | null = null;

const UUID_A = 'a'.repeat(32);
const UUID_B = 'b'.repeat(32);
/** A fresh uuid per call, so the panel's cache from earlier tests cannot answer. */
let uuidSeed = 0;
const freshUuid = () => (++uuidSeed).toString(16).padStart(32, 'c');

function har(
  uuid: string,
  opts: {
    at?: string; execute?: boolean; body?: string; content?: string; origin?: string;
    /** The request carries no Authorization header. */
    anonymous?: boolean;
    /** A live entry whose getContent() answers with this response body. */
    liveBody?: string;
  } = {}
): HarEntry {
  const path = opts.execute ? `chain/execute/${uuid}` : `chain/v2/${uuid}`;
  const entry = {
    startedDateTime: opts.at ?? '2026-01-01T10:00:00.000Z',
    time: 42,
    request: {
      method: opts.execute ? 'POST' : 'GET',
      url: `${opts.origin ?? ORIGIN}/rest/api/automation/${path}`,
      headers: opts.anonymous ? [] : [{ name: 'Authorization', value: 'Bearer t' }],
      queryString: [],
      postData: opts.body ? { mimeType: 'application/json', text: opts.body } : undefined
    },
    response: {
      status: 200,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      content: { size: 10, mimeType: 'application/json', text: opts.content }
    },
    timings: { send: 1, wait: 30, receive: 11 },
    getContent: opts.liveBody === undefined ? undefined : (cb: (body: string) => void) => cb(opts.liveBody!)
  };
  return entry as unknown as HarEntry;
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('#rows tr')];
const visibleRows = () => rows().filter((r) => !r.classList.contains('hidden'));
const cellText = (row: HTMLTableRowElement, i: number) => row.children[i]!.textContent;
const send = (entry: HarEntry) => fakeChrome.devtools.network.onRequestFinished.dispatch(entry);

let panel: AdNetworkPanel;
/** Listener counts before the panel started: stop() must return to them. */
let baseline: number[] = [];
const listenerCounts = () => [
  fakeChrome.devtools.network.onRequestFinished.listeners.length,
  fakeChrome.devtools.network.onNavigated.listeners.length,
  fakeChrome.storage.onChanged.listeners.length
];

/** The panel's promise that origin, site list and cache are loaded. */
const ready = () => (panel as unknown as { ready: Promise<void> }).ready;
const evaluated = () => fakeChrome.devtools.inspectedWindow.evaluated;

/** The inspected tab navigates to `origin`; resolves once the panel has taken it in. */
async function navigate(origin: string) {
  inspected = origin;
  fakeChrome.devtools.network.onNavigated.dispatch(`${origin}/automation-designer/`);
  await ready();
}

beforeAll(async () => {
  const html = readFileSync(join(import.meta.dir, '../../src/devtools/ad-network/panel.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*><\/script>/g, '');
  document.body.innerHTML = body;
  fakeChrome.reset();
  await writeHosts([{ host: 'nsm.test', enabled: true }]);
  fakeChrome.devtools.inspectedWindow.evalHandler = (expr) => (expr === 'location.origin' ? inspected : null);
  // The platform knows every method as "Resolved" in "Cat".
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    fetches.push({ url, auth: init?.headers?.Authorization });
    if (holdFetches) await holdFetches;
    return {
      ok: true,
      status: 200,
      json: async () => ({ name: 'Resolved', metadata: { service: { name: 'Cat' }, state: 'DRAFT' } })
    };
  }) as unknown as typeof fetch;
  panel = new AdNetworkPanel();
  baseline = listenerCounts();
  panel.start();
  await ready();
});
afterAll(() => {
  // Removes every listener and timer the panel started, so none outlives the file.
  panel.stop();
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
    await waitFor(() => cellText(rows()[0]!, 1) === 'Resolved', 'the resolved name');
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

  test('on an allowed site the page\'s fetch/XHR is wrapped for in-flight rows', () => {
    expect(evaluated().includes(WRAPPER_SCRIPT)).toBe(true);
  });

  test('"Open in draft" hands the body over through extension storage, never in the URL', async () => {
    const body = '{"name":"Zoë ✓ 日本"}'; // not Latin-1: btoa() would have refused it
    send(har(UUID_A, { execute: true, body }));
    const open = rows()[0]!.querySelectorAll<HTMLButtonElement>('td.actions button')[2]!;
    open.click();
    await waitFor(() => fakeChrome.tabs.created.length === 1, 'the tab to open');
    const { url, active } = fakeChrome.tabs.created[0] as { url: string; active: boolean };
    const prefix = `${ORIGIN}/automation-designer/Cat/${UUID_A}#${AUTOFILL_FRAGMENT_PARAM}=`;
    expect(url.startsWith(prefix)).toBe(true);
    expect(active).toBe(false); // a background tab
    const id = url.slice(prefix.length);
    expect(/^[0-9a-f]{32}$/.test(id)).toBe(true);
    const stored = fakeChrome.storage.session.data.get(AUTOFILL_HANDOFF_KEY_PREFIX + id) as { body: string };
    expect(stored.body).toBe(body);
  });

  test('on a site that is not allowed: no lookups, no fetch wrapper, and the old site\'s auth is gone', async () => {
    send(har(UUID_A, { execute: true })); // on nsm.test: its Authorization header is learned
    await navigate('https://evil.test');
    expect(evaluated().includes(UNINSTALL_SCRIPT)).toBe(true);

    fetches = [];
    evaluated().length = 0;
    send(har(UUID_B, { execute: true, origin: 'https://evil.test' }));
    await sleep(600); // more than twice the resolve debounce: nothing may be asked
    expect(fetches).toEqual([]);
    expect(evaluated().includes(WRAPPER_SCRIPT)).toBe(false);
    expect(evaluated().some((e) => e.includes('authToken'))).toBe(false);
    expect($('#offline').textContent).toContain('not on an allowed site');

    await navigate(ORIGIN);
    expect(evaluated().includes(WRAPPER_SCRIPT)).toBe(true);
    expect($('#offline').classList.contains('hidden')).toBe(true);

    // The header learned before leaving is gone: a lookup now goes without it.
    fetches = [];
    send(har(freshUuid(), { execute: true, anonymous: true }));
    await waitFor(() => fetches.length > 0, 'a lookup');
    expect(fetches.map((f) => f.auth)).toEqual([undefined]);
  });

  test('a name read from a definition body is shown at once; the category is still looked up', async () => {
    const uuid = freshUuid();
    fetches = [];
    send(har(uuid, { liveBody: JSON.stringify({ name: 'fromBody' }) }));
    expect(cellText(rows()[0]!, 1)).toBe('fromBody');
    await waitFor(() => cellText(rows()[0]!, 2) === 'Cat', 'the category');
    expect(fetches.some((f) => f.url.includes(uuid))).toBe(true);
  });

  test('between a navigation and knowing the new page, nothing is looked up or wrapped', async () => {
    const inspectedWindow = fakeChrome.devtools.inspectedWindow;
    const realEval = inspectedWindow.eval;
    let answerOrigin: (() => void) | null = null;
    inspectedWindow.eval = (expression: string, callback?: (result: unknown) => void) => {
      if (expression !== 'location.origin') return realEval.call(inspectedWindow, expression, callback);
      answerOrigin = () => callback?.(inspected);
    };
    try {
      fakeChrome.devtools.network.onNavigated.dispatch(`${ORIGIN}/automation-designer/`);
      await waitFor(() => answerOrigin !== null, 'the origin to be asked');
      fetches = [];
      evaluated().length = 0;
      const uuid = freshUuid();
      send(har(uuid, { liveBody: JSON.stringify({ name: 'tooEarly' }) }));
      await sleep(600); // more than twice the resolve debounce: nothing may be asked
      expect(fetches).toEqual([]);
      expect(evaluated().includes(WRAPPER_SCRIPT)).toBe(false);
      expect(cellText(rows()[0]!, 1)).not.toBe('tooEarly');

      answerOrigin!();
      await ready();
      await waitFor(() => fetches.some((f) => f.url.includes(uuid)), 'the lookup once the page is known');
      expect(evaluated().includes(WRAPPER_SCRIPT)).toBe(true);
    } finally {
      inspectedWindow.eval = realEval;
    }
  });

  test('stop() while a lookup is in flight: the answer opens no tab and shows nothing', async () => {
    let answer!: () => void;
    holdFetches = new Promise((resolve) => { answer = resolve; });
    try {
      send(har(freshUuid(), { execute: true }));
      rows()[0]!.querySelectorAll<HTMLButtonElement>('td.actions button')[2]!.click();
      await waitFor(() => fetches.length > 0, 'the lookup');
      const toast = $('#toast').textContent;
      const tabs = fakeChrome.tabs.created.length;
      panel.stop();
      answer();
      await sleep(300);
      expect(fakeChrome.tabs.created.length).toBe(tabs);
      expect($('#toast').textContent).toBe(toast);
    } finally {
      holdFetches = null;
      panel.start();
      await ready();
    }
  });

  test('a tab that cannot be created is opened with window.open instead', async () => {
    const realCreate = fakeChrome.tabs.create;
    const realOpen = window.open;
    const opened: string[] = [];
    fakeChrome.tabs.create = async () => { throw new Error('no tabs here'); };
    window.open = ((url: string) => { opened.push(url); return null; }) as typeof window.open;
    try {
      send(har(UUID_A, { execute: true }));
      rows()[0]!.querySelectorAll<HTMLButtonElement>('td.actions button')[2]!.click();
      await waitFor(() => opened.length === 1, 'window.open');
      expect(opened[0]).toBe(`${ORIGIN}/automation-designer/Cat/${UUID_A}`);
    } finally {
      fakeChrome.tabs.create = realCreate;
      window.open = realOpen;
    }
  });

  test('stop() writes the cache at once instead of after its debounce', async () => {
    const uuid = freshUuid();
    send(har(uuid, { execute: true }));
    await waitFor(() => cellText(rows()[0]!, 2) === 'Cat', 'the lookup');
    panel.stop();
    const stored = () => {
      const value = fakeChrome.storage.local.data.get(AD_CACHE_STORAGE_KEY) as { entries: Record<string, unknown> } | undefined;
      return Boolean(value?.entries[`${ORIGIN}|${uuid}`]);
    };
    try {
      await waitFor(stored, 'the flushed cache entry', 200); // the debounce is 400 ms
    } finally {
      panel.start();
      await ready();
    }
  });

  test('start() is idempotent; stop() removes what it added; it restarts', async () => {
    await ready(); // the site-list watcher is added once loading settles
    const running = listenerCounts();
    panel.start(); // already started: adds nothing
    expect(listenerCounts()).toEqual(running);
    panel.stop();
    expect(listenerCounts()).toEqual(baseline);
    send(har(UUID_A));
    expect(rows().length).toBe(0);
    panel.start();
    send(har(UUID_A));
    expect(rows().length).toBe(1);
  });
});
