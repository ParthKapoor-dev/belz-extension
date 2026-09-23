import { afterEach, describe, expect, test } from 'bun:test';
import {
  fetchComponentGraph,
  fetchJson,
  fetchPageConfig,
  fetchShellConfig
} from '../../src/pd-inspector-page/config';

const ctx = { host: 'app.test', path: 'lt-261/9f2c/details', env: 'app' };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

interface Deployed { path: string; layout: unknown; referencePageId?: string }

/**
 * A fake deployable endpoint. `pages` / `components` are keyed by exact path;
 * `routes` is the dynamicRoute table returned with deployableInfo=true.
 */
function serveDeployables(opts: {
  pages?: Record<string, Deployed>;
  components?: Record<string, Deployed>;
  routes?: Array<{ path: string }>;
}) {
  const requested: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = new URL(url, 'https://app.test');
    const type = u.searchParams.get('pageType');
    const path = u.searchParams.get('path')!;
    requested.push(`${type}:${path}`);
    const body = (() => {
      if (u.searchParams.get('deployableInfo')) return { dynamicRoute: JSON.stringify(opts.routes || []) };
      const table = type === 'COMPONENT' ? opts.components : opts.pages;
      const hit = table?.[path];
      if (!hit) return { deployedPages: [null] };
      return { deployedPages: [{ path: hit.path, referencePageId: hit.referencePageId || '', compiledConfig: JSON.stringify({ layout: hit.layout }) }] };
    })();
    return { ok: true, status: 200, json: async () => body };
  }) as any;
  return requested;
}

describe('fetchPageConfig', () => {
  test('fetchJson retries a network error or a transient status, never a definite one', async () => {
    /** Answers the queued statuses in turn (0: a network error), then 200. */
    const serveStatuses = (statuses: number[]) => {
      let calls = 0;
      globalThis.fetch = (async () => {
        const status = statuses[calls++] ?? 200;
        if (status === 0) throw new TypeError('Failed to fetch');
        return { ok: status < 400, status, json: async () => ({ ok: true }) };
      }) as any;
      return () => calls;
    };

    let calls = serveStatuses([0, 503]);
    expect(await fetchJson('/x')).toEqual({ ok: true });
    expect(calls()).toBe(3);

    calls = serveStatuses([429, 429, 429, 200]);
    await expect(fetchJson('/x')).rejects.toThrow('HTTP 429');
    expect(calls()).toBe(3);

    for (const status of [401, 403, 404]) {
      calls = serveStatuses([status]);
      await expect(fetchJson('/x')).rejects.toThrow(`HTTP ${status}`);
      expect(calls()).toBe(1);
    }
  });

  test('a static page is found at its literal path', async () => {
    serveDeployables({ pages: { [ctx.path]: { path: ctx.path, layout: { name: 'root' }, referencePageId: 'r1' } } });
    expect(await fetchPageConfig(ctx)).toEqual({
      path: ctx.path, referencePageId: 'r1', pageVersionId: 0, layout: { name: 'root' }
    });
  });

  test('a URL with a record id resolves through the route table', async () => {
    const template = 'lt-261/:id/details';
    serveDeployables({
      routes: [{ path: 'lt-261/:a/:b' }, { path: template }, { path: 'other/:id' }],
      pages: { [template]: { path: template, layout: { name: 'root' } } }
    });
    // The more specific template (fewer params) wins.
    expect((await fetchPageConfig(ctx)).path).toBe(template);
  });

  test('nothing deployed is an error', async () => {
    serveDeployables({});
    await expect(fetchPageConfig(ctx)).rejects.toThrow('no deployed page');
  });
});

describe('fetchShellConfig', () => {
  test('the first path segment is a shell only if its layout has an outlet', async () => {
    serveDeployables({ pages: { 'lt-261': { path: 'lt-261', layout: { name: 'x', children: [{ name: 'router-outlet' }] } } } });
    expect((await fetchShellConfig(ctx, ctx.path))?.path).toBe('lt-261');

    serveDeployables({ pages: { 'lt-261': { path: 'lt-261', layout: { name: 'x', children: [] } } } });
    expect(await fetchShellConfig(ctx, ctx.path)).toBeNull();
  });

  test('a single-segment page cannot be its own shell', async () => {
    const requested = serveDeployables({});
    expect(await fetchShellConfig({ ...ctx, path: 'home' }, 'home')).toBeNull();
    expect(requested).toEqual([]);
  });
});

describe('fetchComponentGraph', () => {
  test('fetches embedded components transitively, each once, stubbing failures', async () => {
    const requested = serveDeployables({
      components: {
        a: { path: 'a', layout: { name: 'x', children: [{ name: 'b', isSymbol: true }, { name: 'b', isSymbol: true }] } },
        b: { path: 'b', layout: { name: 'x', children: [] } }
      }
    });
    const page = { name: 'root', children: [{ name: 'a', isSymbol: true }, { name: 'missing', isSymbol: true }] };
    const graph = await fetchComponentGraph(ctx, page);

    expect([...graph.keys()].sort()).toEqual(['a', 'b', 'missing']);
    expect(graph.get('missing')?.error).toContain('component not found');
    expect(requested.filter((r) => r === 'COMPONENT:b')).toHaveLength(1);
  });
});
