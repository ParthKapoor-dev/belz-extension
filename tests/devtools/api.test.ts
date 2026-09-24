import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../fakes/chrome';
import { InspectedSite } from '../../src/devtools/ad-network/origin';
import { MethodCache } from '../../src/devtools/ad-network/cache';
import { ApiError, MethodResolver, noDesignerUrlReason } from '../../src/devtools/ad-network/api';
import { writeHosts } from '../../src/shared/hosts';
import type { MethodSummary } from '../../src/devtools/ad-network/types';

// Every test gets its own site, cache and resolver: nothing is shared.

const ORIGIN = 'https://nsm.test';
const OTHER = 'https://other.test';
const UUID = 'f'.repeat(32);
const realFetch = globalThis.fetch;

interface Call { url: string; headers: Record<string, string> }
let calls: Call[];

/** Route fetches by path. A handler returns [status, body]; it sees the headers sent. */
function serve(routes: Record<string, (headers: Record<string, string>) => [number, unknown]>) {
  globalThis.fetch = (async (url: string, init: any) => {
    const headers = init?.headers || {};
    calls.push({ url, headers });
    const path = new URL(url).pathname;
    const route = Object.keys(routes).find((p) => path.startsWith(p));
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    const [status, body] = routes[route]!(headers);
    return { ok: status < 400, status, json: async () => body };
  }) as any;
}
const V2 = '/rest/api/automation/chain/v2/';
const found = (name = 'getUser') => [200, { name, metadata: { service: { name: 'Users' } } }] as [number, unknown];

/** The inspected page: its origin, and what its storage scan finds. */
let page: { origin: string; token: string | null };
let scans = 0;

let site: InspectedSite;
let cache: MethodCache;
let resolver: MethodResolver;

/** Point DevTools at `origin` and let the site re-detect it. */
async function navigate(origin: string, token: string | null = null) {
  page = { origin, token };
  await site.detect();
}

beforeEach(async () => {
  fakeChrome.reset();
  calls = [];
  scans = 0;
  page = { origin: ORIGIN, token: null };
  fakeChrome.devtools.inspectedWindow.evalHandler = (expr) => {
    if (expr === 'location.origin') return page.origin;
    if (expr.includes('authToken')) {
      scans++;
      return { origin: page.origin, token: page.token };
    }
    return null;
  };
  await writeHosts([{ host: 'nsm.test', enabled: true }, { host: 'other.test', enabled: true }]);
  site = new InspectedSite();
  cache = new MethodCache();
  resolver = new MethodResolver(site, cache);
  await Promise.all([site.detect(), site.loadSiteConfig(), cache.hydrate()]);
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('resolveSummary', () => {
  test('reads name, category, state and referenceId from the v2 endpoint', async () => {
    serve({
      [V2]: () => [200, {
        name: 'getUser',
        metadata: { service: { name: 'Users' }, state: 'PUBLISHED', referenceId: 'draft-1' }
      }]
    });
    expect(await resolver.resolveSummary(UUID)).toEqual({
      name: 'getUser', category: 'Users', state: 'PUBLISHED', referenceId: 'draft-1'
    });
    expect(calls[0]!.url).toBe(`${ORIGIN}${V2}${UUID}?basicInfo=false`);
  });

  test('falls back to v1 when v2 is missing', async () => {
    serve({
      [V2]: () => [404, {}],
      '/rest/api/automation/chain/': () => [200, {
        jsonDefinition: JSON.stringify({ name: 'old' }),
        category: { name: 'Legacy' },
        automationState: 'DRAFT'
      }]
    });
    expect(await resolver.resolveSummary(UUID)).toMatchObject({ name: 'old', category: 'Legacy', state: 'DRAFT' });
    expect(calls).toHaveLength(2);
  });

  test('a document that does not give the state leaves it unknown, never "DRAFT"', async () => {
    serve({ [V2]: () => found() });
    expect(await resolver.resolveSummary(UUID)).toEqual({ name: 'getUser', category: 'Users', state: null, referenceId: null });
  });

  test('a 401 is reported as "not signed in" without trying v1', async () => {
    serve({ '/rest/api/automation/chain/': () => [401, {}] });
    await expect(resolver.resolveSummary(UUID)).rejects.toThrow('not signed in');
    expect(calls).toHaveLength(1);
  });

  test('a second resolve is served from the cache', async () => {
    serve({ [V2]: () => found('cached') });
    await resolver.resolveSummary(UUID);
    await resolver.resolveSummary(UUID);
    expect(calls).toHaveLength(1);
  });

  test('concurrent resolves of one uuid share a request', async () => {
    serve({ [V2]: () => found('once') });
    await Promise.all([resolver.resolveSummary(UUID), resolver.resolveSummary(UUID), resolver.resolveSummary(UUID)]);
    expect(calls).toHaveLength(1);
  });

  test('replays auth headers lifted from an observed request', async () => {
    resolver.rememberAuth({ request: { url: `${ORIGIN}/rest/api/automation/chain/execute/${UUID}`, headers: [
      { name: 'Authorization', value: 'Bearer abc' },
      { name: 'Cookie', value: 'not-replayed' }
    ] } });
    serve({ [V2]: () => found() });
    await resolver.resolveSummary(UUID);
    expect(calls[0]!.headers.Authorization).toBe('Bearer abc');
    expect(calls[0]!.headers.Cookie).toBeUndefined();
  });
});

describe('auth stays with its origin', () => {
  const observed = (origin: string, value: string) => ({
    request: { url: `${origin}/rest/api/automation/chain/execute/${UUID}`, headers: [{ name: 'Authorization', value }] }
  });

  test('headers seen on one site are never sent to another', async () => {
    resolver.rememberAuth(observed(ORIGIN, 'Bearer nsm-token'));
    await navigate(OTHER);
    serve({ [V2]: () => found() });
    await resolver.resolveSummary(UUID);
    expect(calls[0]!.url.startsWith(OTHER)).toBe(true);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  test('a page token is only sent to the origin it was read on', async () => {
    // The scan answers from a page that is no longer the one being asked about.
    page = { origin: OTHER, token: 'eyJ.from.other' };
    serve({ [V2]: () => found() });
    await resolver.resolveSummary(UUID); // inspected origin is still ORIGIN
    expect(calls[0]!.url.startsWith(ORIGIN)).toBe(true);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  test('forgetAuth() (the panel calls it on navigation) drops harvested headers and the scanned token', async () => {
    resolver.rememberAuth(observed(ORIGIN, 'Bearer old'));
    page.token = 'scanned-1';
    resolver.forgetAuth();
    serve({ [V2]: () => found() });
    await resolver.resolveSummary(UUID);
    // Not the harvested header: a fresh scan instead.
    expect(calls[0]!.headers.Authorization).toBe('Bearer scanned-1');
  });

  test('headers from a site that is not allowed are not kept', async () => {
    resolver.rememberAuth(observed('https://evil.test', 'Bearer stolen?'));
    await navigate('https://evil.test');
    await expect(resolver.resolveSummary(UUID)).rejects.toThrow('not on an allowed site');
  });

  test('on a site that is not allowed, nothing is asked at all', async () => {
    await navigate('https://evil.test');
    serve({ [V2]: () => found() });
    const err = await resolver.resolveSummary(UUID).catch((e: unknown) => e);
    expect(err instanceof ApiError && err.final).toBe(true);
    expect(calls).toHaveLength(0);
    expect(scans).toBe(0);
  });
});

describe('token scan', () => {
  test('a scan that found nothing is not remembered: the next lookup scans again', async () => {
    serve({ [V2]: () => found() });
    await resolver.resolveSummary(UUID);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    page.token = 'late-token'; // the user signed in meanwhile
    await resolver.resolveSummary('e'.repeat(32));
    expect(calls[1]!.headers.Authorization).toBe('Bearer late-token');
    expect(scans).toBe(2);
  });

  test('a 401 drops the token, scans again and retries once', async () => {
    page.token = 'expired';
    serve({
      [V2]: (headers) => (headers.Authorization === 'Bearer fresh' ? found('ok') : [401, {}])
    });
    const first = resolver.resolveSummary(UUID);
    page.token = 'fresh'; // what the page holds by the time of the rescan
    expect((await first)?.name).toBe('ok');
    expect(calls.map((c) => c.headers.Authorization)).toEqual(['Bearer expired', 'Bearer fresh']);
  });

  test('a 401 that persists is reported, after one retry only', async () => {
    page.token = 'bad';
    serve({ [V2]: () => [401, {}] });
    await expect(resolver.resolveSummary(UUID)).rejects.toThrow('not signed in');
    expect(calls).toHaveLength(2);
  });
});

describe('buildDesignerUrl', () => {
  const summary = (fields: Partial<MethodSummary>): MethodSummary =>
    ({ name: 'm', category: null, state: 'DRAFT', referenceId: null, ...fields });

  test('a draft opens by its own uuid', () => {
    expect(resolver.buildDesignerUrl('u1', summary({ category: 'My Cat' })))
      .toBe(`${ORIGIN}/automation-designer/My%20Cat/u1`);
  });

  test('a published method opens its linked draft', () => {
    expect(resolver.buildDesignerUrl('u1', summary({ category: 'C', state: 'PUBLISHED', referenceId: 'd9' })))
      .toBe(`${ORIGIN}/automation-designer/C/d9`);
  });

  test('the designer host override is used for the link', async () => {
    await writeHosts([{ host: 'nsm.test', enabled: true, designerHost: 'staff.nsm.test' }]);
    await site.loadSiteConfig();
    expect(resolver.buildDesignerUrl('u1', summary({ category: 'C' })))
      .toBe('https://staff.nsm.test/automation-designer/C/u1');
  });

  test('no summary, or no category, or an unknown page: no url, nothing guessed', () => {
    expect(resolver.buildDesignerUrl('u1', null)).toBeNull();
    expect(resolver.buildDesignerUrl('u1', summary({ name: 'only a name' }))).toBeNull();
    site.forget();
    expect(resolver.buildDesignerUrl('u1', summary({ category: 'C' }))).toBeNull();
  });

  test('only a known draft opens its own uuid: an unknown state, or a published method without a draft, has no url', () => {
    const unknown = summary({ category: 'C', state: null });
    const orphan = summary({ category: 'C', state: 'PUBLISHED' });
    expect(resolver.buildDesignerUrl('u1', unknown)).toBeNull();
    expect(resolver.buildDesignerUrl('u1', orphan)).toBeNull();
    expect(noDesignerUrlReason(unknown)).toBe('the platform did not say whether the method is a draft');
    expect(noDesignerUrlReason(orphan)).toBe('the published method names no draft to open');
    expect(noDesignerUrlReason(summary({}))).toBe('the method has no category to open it under');
    expect(noDesignerUrlReason(null)).toBe('method not found on this instance');
  });
});

describe('the cache', () => {
  test('a method that has no category is cached like any other: it is not asked for again', async () => {
    serve({ [V2]: () => [200, { name: 'getUser', metadata: { state: 'DRAFT' } }] });
    const first = await resolver.resolveSummary(UUID);
    expect(first).toEqual({ name: 'getUser', category: null, state: 'DRAFT', referenceId: null });
    expect(await resolver.resolveSummary(UUID)).toMatchObject({ name: 'getUser', category: null });
    expect(calls).toHaveLength(1);
  });

  test('requests refuse to follow a redirect, so auth headers stay on the origin', async () => {
    let redirect: unknown;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      redirect = init.redirect;
      calls.push({ url, headers: {} });
      return { ok: true, status: 200, json: async () => found()[1] };
    }) as unknown as typeof fetch;
    await resolver.resolveSummary(UUID);
    expect(redirect).toBe('error');
  });
});
