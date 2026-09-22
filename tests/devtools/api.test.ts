import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../fakes/chrome';
import { detectOrigin } from '../../src/devtools/ad-network/origin';
import { hydrate } from '../../src/devtools/ad-network/cache';
import { buildDesignerUrl, rememberAuth, resolveSummary } from '../../src/devtools/ad-network/api';

const ORIGIN = 'https://nsm.test';
const realFetch = globalThis.fetch;

interface Call { url: string; headers: Record<string, string> }
let calls: Call[];

/** Route fetches by path. A handler returns [status, body]. */
function serve(routes: Record<string, () => [number, unknown]>) {
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, headers: init?.headers || {} });
    const path = new URL(url).pathname;
    const route = Object.keys(routes).find((p) => path.startsWith(p));
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    const [status, body] = routes[route]();
    return { ok: status < 400, status, json: async () => body };
  }) as any;
}

// Each test uses its own uuid: the module keeps an in-memory cache.
let n = 0;
const nextUuid = () => (++n).toString(16).padStart(32, '0');

beforeAll(async () => {
  fakeChrome.devtools.inspectedWindow.evalHandler = (expr) => (expr === 'location.origin' ? ORIGIN : null);
  await detectOrigin();
  await hydrate();
});
beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('resolveSummary', () => {
  test('reads name, category, state and referenceId from the v2 endpoint', async () => {
    const uuid = nextUuid();
    serve({
      '/rest/api/automation/chain/v2/': () => [200, {
        name: 'getUser',
        metadata: { service: { name: 'Users' }, state: 'PUBLISHED', referenceId: 'draft-1' }
      }]
    });
    expect(await resolveSummary(uuid)).toEqual({
      name: 'getUser', category: 'Users', state: 'PUBLISHED', referenceId: 'draft-1'
    });
    expect(calls[0].url).toBe(`${ORIGIN}/rest/api/automation/chain/v2/${uuid}?basicInfo=false`);
  });

  test('falls back to v1 when v2 is missing', async () => {
    const uuid = nextUuid();
    serve({
      '/rest/api/automation/chain/v2/': () => [404, {}],
      '/rest/api/automation/chain/': () => [200, {
        jsonDefinition: JSON.stringify({ name: 'old' }),
        category: { name: 'Legacy' },
        automationState: 'DRAFT'
      }]
    });
    expect(await resolveSummary(uuid)).toMatchObject({ name: 'old', category: 'Legacy', state: 'DRAFT' });
    expect(calls).toHaveLength(2);
  });

  test('a 401 is reported as "not signed in" without trying v1', async () => {
    serve({ '/rest/api/automation/chain/': () => [401, {}] });
    await expect(resolveSummary(nextUuid())).rejects.toThrow('not signed in');
    expect(calls).toHaveLength(1);
  });

  test('a second resolve is served from the cache', async () => {
    const uuid = nextUuid();
    serve({ '/rest/api/automation/chain/v2/': () => [200, { name: 'cached', metadata: {} }] });
    await resolveSummary(uuid);
    await resolveSummary(uuid);
    expect(calls).toHaveLength(1);
  });

  test('concurrent resolves of one uuid share a request', async () => {
    const uuid = nextUuid();
    serve({ '/rest/api/automation/chain/v2/': () => [200, { name: 'once', metadata: {} }] });
    await Promise.all([resolveSummary(uuid), resolveSummary(uuid), resolveSummary(uuid)]);
    expect(calls).toHaveLength(1);
  });

  test('replays auth headers lifted from an observed request', async () => {
    rememberAuth({ request: { headers: [
      { name: 'Authorization', value: 'Bearer abc' },
      { name: 'Cookie', value: 'not-replayed' }
    ] } });
    serve({ '/rest/api/automation/chain/v2/': () => [200, { name: 'x', metadata: {} }] });
    await resolveSummary(nextUuid());
    expect(calls[0].headers.Authorization).toBe('Bearer abc');
    expect(calls[0].headers.Cookie).toBeUndefined();
  });
});

describe('buildDesignerUrl', () => {
  test('a draft opens by its own uuid', () => {
    expect(buildDesignerUrl('u1', { category: 'My Cat', state: 'DRAFT' }))
      .toBe(`${ORIGIN}/automation-designer/My%20Cat/u1`);
  });

  test('a published method opens its linked draft', () => {
    expect(buildDesignerUrl('u1', { category: 'C', state: 'PUBLISHED', referenceId: 'd9' }))
      .toBe(`${ORIGIN}/automation-designer/C/d9`);
  });

  test('no summary, no url', () => {
    expect(buildDesignerUrl('u1', null)).toBeNull();
  });
});
