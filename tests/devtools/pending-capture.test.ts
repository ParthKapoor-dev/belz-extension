import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../fakes/chrome';
import {
  PendingCapture,
  READ_SCRIPT,
  UNINSTALL_SCRIPT,
  wrapperScript
} from '../../src/devtools/ad-network/pending-capture';
import { PAGE_GLOBALS } from '../../src/config/namespace';
import type { PendingEntry } from '../../src/devtools/ad-network/types';
import { waitFor } from '../wait';

// The scripts PendingCapture runs in the inspected page, run here against the
// test page's own window: the wrapper tracks chain requests, and uninstalling
// puts the page's fetch and XMLHttpRequest back. PendingCapture itself runs
// them through the fake inspectedWindow.eval, against the same window.

const CHAIN_URL = 'https://nsm.test/rest/api/automation/chain/execute/' + 'a'.repeat(32);
/** The test page's own origin: the one the wrapper is installed for. */
const ORIGIN = location.origin;
const WRAPPER_SCRIPT = wrapperScript(ORIGIN);
const page = window as unknown as Record<string, unknown> & { fetch: typeof fetch };
const runInPage = (script: string): unknown => (0, eval)(script);
const state = () => page[PAGE_GLOBALS.capture] as { pending: Map<number, { url: string }> } | undefined;
const pending = () => state()?.pending;
const read = () => runInPage(READ_SCRIPT) as PendingEntry[] | false;

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
});

describe('the page-side wrapper', () => {
  test('lists a chain request while it is in flight, and only a chain request', async () => {
    runInPage(WRAPPER_SCRIPT);
    expect(page.fetch === pageFetch).toBe(false);
    const done = page.fetch(CHAIN_URL);
    void page.fetch('https://nsm.test/other');
    expect([...pending()!.values()].map((e) => e.url)).toEqual([CHAIN_URL]);
    expect((read() as PendingEntry[]).map((e) => e.url)).toEqual([CHAIN_URL]);
    release();
    await done;
    expect(pending()!.size).toBe(0);
  });

  test('it installs only on the https page of the origin it is for', () => {
    expect(runInPage(wrapperScript('https://other.test'))).toBe(false);
    expect(page.fetch === pageFetch).toBe(true);
    expect(state() === undefined).toBe(true);
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
    expect(state() === undefined).toBe(true);
    expect(read()).toBe(false);
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
    expect(read()).toBe(false); // switched off
    const done = page.fetch(CHAIN_URL);
    expect(pageWrapperCalls).toBe(1);
    expect(pending()!.size).toBe(0); // not tracked any more
    release();
    await done;
  });

  test('installing over a wrapper that could not be removed switches it on again', async () => {
    runInPage(WRAPPER_SCRIPT);
    const ours = page.fetch;
    const pageWrapper = ((input: RequestInfo, init?: RequestInit) => ours(input, init)) as typeof fetch;
    page.fetch = pageWrapper;
    runInPage(UNINSTALL_SCRIPT);

    runInPage(WRAPPER_SCRIPT);
    expect(page.fetch === pageWrapper).toBe(true); // the page's wrapper stays on top
    const done = page.fetch(CHAIN_URL);
    expect((read() as PendingEntry[]).map((e) => e.url)).toEqual([CHAIN_URL]);
    release();
    await done;
  });
});

describe('PendingCapture', () => {
  let capture: PendingCapture;
  let reported: string[][];

  beforeEach(() => {
    fakeChrome.reset();
    fakeChrome.devtools.inspectedWindow.evalHandler = runInPage;
    reported = [];
    capture = new PendingCapture((entries) => reported.push(entries.map((e) => e.url)));
  });
  afterEach(() => {
    capture.stop();
    fakeChrome.devtools.inspectedWindow.evalHandler = () => undefined;
  });

  test('a wrapper that retired itself is installed again by the next poll', async () => {
    capture.start(ORIGIN);
    await waitFor(() => page.fetch !== pageFetch, 'the wrapper');
    runInPage(UNINSTALL_SCRIPT); // what the page does after STALE_MS without a poll
    expect(page.fetch === pageFetch).toBe(true);

    await waitFor(() => page.fetch !== pageFetch, 'the wrapper to be installed again');
    const done = page.fetch(CHAIN_URL);
    await waitFor(() => reported.some((urls) => urls.includes(CHAIN_URL)), 'the in-flight row');
    release();
    await done;
  });

  test('a poll after the page moved to another origin does not wrap the new page', async () => {
    // Started for another site: as when the tab navigated and a poll ran
    // before the panel heard of it (onNavigated).
    capture.start('https://other.test');
    await waitFor(() => fakeChrome.devtools.inspectedWindow.evaluated.filter((e) => e === READ_SCRIPT).length >= 2, 'a poll');
    expect(page.fetch === pageFetch).toBe(true);
    expect(state() === undefined).toBe(true);
  });

  test('stop() puts the page\'s fetch back and reports no rows', async () => {
    capture.start(ORIGIN);
    await waitFor(() => page.fetch !== pageFetch, 'the wrapper');
    capture.stop();
    await waitFor(() => page.fetch === pageFetch, 'the page\'s own fetch');
    expect(reported.at(-1)).toEqual([]);
  });
});
