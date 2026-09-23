import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { UNINSTALL_SCRIPT, WRAPPER_SCRIPT } from '../../src/devtools/ad-network/pending-capture';
import { PAGE_GLOBALS } from '../../src/config/namespace';

// The scripts PendingCapture runs in the inspected page, run here against the
// test page's own window: the wrapper tracks chain requests, and uninstalling
// puts the page's fetch and XMLHttpRequest back.

const CHAIN_URL = 'https://nsm.test/rest/api/automation/chain/execute/' + 'a'.repeat(32);
const page = window as unknown as Record<string, unknown> & { fetch: typeof fetch };
const runInPage = (script: string) => (0, eval)(script);
const pending = () => page[PAGE_GLOBALS.pending] as Map<number, { url: string }> | undefined;

let pageFetch: typeof fetch;
let releases: Array<() => void> = [];
const release = () => { for (const r of releases.splice(0)) r(); };
const realFetch = window.fetch;
const realOpen = XMLHttpRequest.prototype.open;
const realSend = XMLHttpRequest.prototype.send;

beforeEach(() => {
  // The page's own fetch: answers when the test says so.
  releases = [];
  pageFetch = (() => new Promise<Response>((resolve) => { releases.push(() => resolve(new Response('{}'))); })) as unknown as typeof fetch;
  page.fetch = pageFetch;
});
afterEach(() => {
  runInPage(UNINSTALL_SCRIPT);
  page.fetch = realFetch;
  XMLHttpRequest.prototype.open = realOpen;
  XMLHttpRequest.prototype.send = realSend;
  delete page[PAGE_GLOBALS.capture];
  delete page[PAGE_GLOBALS.pending];
});

describe('the page-side wrapper', () => {
  test('lists a chain request while it is in flight, and only a chain request', async () => {
    runInPage(WRAPPER_SCRIPT);
    expect(page.fetch === pageFetch).toBe(false);
    const done = page.fetch(CHAIN_URL);
    void page.fetch('https://nsm.test/other');
    expect([...pending()!.values()].map((e) => e.url)).toEqual([CHAIN_URL]);
    release();
    await done;
    expect(pending()!.size).toBe(0);
  });

  test('installing twice wraps once', () => {
    runInPage(WRAPPER_SCRIPT);
    const wrapped = page.fetch;
    runInPage(WRAPPER_SCRIPT);
    expect(page.fetch === wrapped).toBe(true);
  });

  test('uninstalling puts the page\'s own fetch and XMLHttpRequest back', () => {
    runInPage(WRAPPER_SCRIPT);
    expect(XMLHttpRequest.prototype.open === realOpen).toBe(false);
    runInPage(UNINSTALL_SCRIPT);
    expect(page.fetch === pageFetch).toBe(true);
    expect(XMLHttpRequest.prototype.open === realOpen).toBe(true);
    expect(XMLHttpRequest.prototype.send === realSend).toBe(true);
    expect(page[PAGE_GLOBALS.capture] === undefined).toBe(true);
    expect(pending() === undefined).toBe(true);
  });

  test('a wrapper the page put on top of ours is left alone; ours only stops tracking', async () => {
    runInPage(WRAPPER_SCRIPT);
    const ours = page.fetch;
    let pageWrapperCalls = 0;
    const pageWrapper = ((input: RequestInfo, init?: RequestInit) => {
      pageWrapperCalls++;
      return ours(input, init);
    }) as typeof fetch;
    page.fetch = pageWrapper;

    runInPage(UNINSTALL_SCRIPT);
    expect(page.fetch === pageWrapper).toBe(true);
    const done = page.fetch(CHAIN_URL);
    expect(pageWrapperCalls).toBe(1);
    expect(pending() === undefined).toBe(true); // not tracked any more
    release();
    await done;
  });
});
