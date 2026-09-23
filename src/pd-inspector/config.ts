// Published-page + component config fetch.
//
// A published app page (/pages/<path>) renders from a compiled Page Designer
// config. That config embeds PD *components* (symbols) by name; each component
// has its own compiled config, fetched recursively here so the panel can show
// the full component-nesting tree.
//
// Everything is served cookie-authed, same-origin, by the deployable endpoint.

import { PD_DEPLOYABLE_PATH as DEPLOYABLE } from '../config/endpoints';
import { PAGES_ROUTE_PREFIX } from '../config/routes';
import { PD_CONFIG_NODES } from '../config/selectors';
import { createLogger } from '../shared/logger';
import type {
  ComponentConfig,
  ComponentGraph,
  PageConfig,
  PageContext,
  RawLayoutNode
} from './types';

const log = createLogger('pd-inspector');

/** A deployed page as the deployable endpoint returns it. */
interface DeployedPage {
  path?: string;
  referencePageId?: string;
  pageVersionId?: number;
  /** The compiled config, as a JSON string. */
  compiledConfig: string;
}

/** A child reference inside a layout: an embedded component, or the outlet. */
export type ChildRef = { type: 'symbol'; name: string } | { type: 'outlet' };

/** Pull the env slug out of a verifi/expertly host (e.g. "nsm-dev"). */
function envFromHost(host: string): string {
  const m = host.match(/^([a-z0-9-]+)\./i);
  return m?.[1] ?? host;
}

/**
 * Read the published-page context from `location`, or null when the current
 * URL is not a /pages/ app page.
 */
export function getPageContext(): PageContext | null {
  if (!location.pathname.startsWith(PAGES_ROUTE_PREFIX)) return null;
  const path = location.pathname.slice(PAGES_ROUTE_PREFIX.length).replace(/\/$/, '');
  if (!path) return null;
  return { host: location.host, path, env: envFromHost(location.host) };
}

/**
 * A symbol *reference* — where a page/component embeds another component.
 * Distinct from a component *definition* root, which also carries `isSymbol`
 * but has children (its actual content). References are childless leaves.
 */
export function isSymbolRef(n: RawLayoutNode | null | undefined): n is RawLayoutNode & { name: string } {
  return !!(
    n &&
    n.isSymbol &&
    n.name &&
    !(n.children && n.children.length)
  );
}

/**
 * Child references of a layout in document order — embedded components, and the
 * outlet where a content page is spliced in.
 *
 * The outlet is reported as a ref so the component tree and the anchor walk can
 * both place the content page at its true position among the shell's own
 * content, rather than appending it.
 */
export function collectChildRefs(layoutRoot: RawLayoutNode | null): ChildRef[] {
  const refs: ChildRef[] = [];
  const walk = (n: RawLayoutNode | null | undefined) => {
    if (!n || typeof n !== 'object') return;
    if (isSymbolRef(n)) {
      refs.push({ type: 'symbol', name: n.name });
      return; // a ref is a leaf; its content lives in its own config
    }
    if (n.name === PD_CONFIG_NODES.outlet) refs.push({ type: 'outlet' });
    (n.children || []).forEach(walk);
  };
  walk(layoutRoot);
  return refs;
}

/** Names of every embedded-component reference in a layout, in document order. */
export function collectSymbolNames(layoutRoot: RawLayoutNode | null): string[] {
  return collectChildRefs(layoutRoot)
    .flatMap((r) => (r.type === 'symbol' ? [r.name] : []));
}

/** True when a layout splices another page in — i.e. it is an app shell. */
export function hasOutlet(layoutRoot: RawLayoutNode | null): boolean {
  return collectChildRefs(layoutRoot).some((r) => r.type === 'outlet');
}

/** fetch + parse JSON, with retries — rapid sequential fetches drop transiently. */
async function fetchJson(url: string): Promise<unknown> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      log.debug(`fetch attempt ${attempt + 1} failed:`, url, err);
    }
  }
  throw lastErr || new Error('fetch failed');
}

/**
 * Fetch one deployable entry by exact path. The endpoint answers 200 with
 * `deployedPages: [null]` (not 404) when nothing is deployed at that path —
 * treated here as "not found".
 */
async function fetchDeployable(
  ctx: PageContext,
  pageType: 'ALL' | 'PAGE' | 'COMPONENT',
  path: string
): Promise<DeployedPage | null> {
  const url =
    `${DEPLOYABLE}?pageType=${pageType}` +
    `&domain=${encodeURIComponent(ctx.host)}` +
    `&path=${encodeURIComponent(path)}`;
  const json = (await fetchJson(url)) as { deployedPages?: Array<DeployedPage | null> } | null;
  const deployed = json?.deployedPages?.[0];
  return deployed || null;
}

/**
 * Match an app path against a route template. `:param` template segments
 * match any single path segment. Returns the param count (lower is more
 * specific) when it matches, or -1 when it does not.
 */
function matchRoute(appPath: string, template: string): number {
  const a = appPath.split('/').filter(Boolean);
  const t = template.split('/').filter(Boolean);
  if (a.length !== t.length) return -1;
  let params = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i]!.charAt(0) === ':') {
      params++;
      continue;
    }
    if (t[i] !== a[i]) return -1;
  }
  return params;
}

/**
 * Resolve the raw app path to the canonical deployed-page path.
 *
 * App URLs can embed dynamic route parameters as path segments — e.g. a
 * record id in `.../LT-261/<uuid>/details`. The deployed page is registered
 * under the route *template* (`.../LT-261/:id/details`), so the literal URL
 * path matches nothing. The deployable endpoint exposes the domain's route
 * table via its `dynamicRoute` field; this matches the URL against those
 * templates. Falls back to the literal path for static (non-parameterised)
 * pages and whenever the route table is unavailable.
 */
async function resolveDeployedPath(ctx: PageContext): Promise<string> {
  const firstSeg = ctx.path.split('/').filter(Boolean)[0] || ctx.path;
  let routes: unknown[] = [];
  try {
    const json = await fetchJson(
      `${DEPLOYABLE}?pageType=PAGE` +
        `&domain=${encodeURIComponent(ctx.host)}` +
        `&path=${encodeURIComponent(firstSeg)}` +
        `&deployableInfo=true`
    );
    let raw: unknown = (json as { dynamicRoute?: unknown } | null)?.dynamicRoute;
    if (typeof raw === 'string') raw = JSON.parse(raw);
    if (Array.isArray(raw)) routes = raw;
  } catch (err) {
    log.debug('route table unavailable, using the literal path:', err);
    return ctx.path;
  }

  let best: string | null = null;
  let bestParams = Infinity;
  for (const r of routes as Array<{ path?: unknown } | null>) {
    if (!r || typeof r.path !== 'string') continue;
    const params = matchRoute(ctx.path, r.path);
    if (params >= 0 && params < bestParams) {
      best = r.path;
      bestParams = params;
    }
  }
  return best || ctx.path;
}

/** Fetch + parse the compiled config for the current published page. */
export async function fetchPageConfig(ctx: PageContext): Promise<PageConfig> {
  // The literal URL path is correct for static pages and the cheapest probe.
  let deployed = await fetchDeployable(ctx, 'ALL', ctx.path);

  // No deployed page at the literal path — the URL probably embeds route
  // params (record ids etc.); resolve it against the route table.
  if (!deployed) {
    const resolved = await resolveDeployedPath(ctx);
    if (resolved !== ctx.path) {
      deployed = await fetchDeployable(ctx, 'ALL', resolved);
    }
  }
  if (!deployed) throw new Error('no deployed page for this path');

  const compiled = JSON.parse(deployed.compiledConfig) as { layout?: RawLayoutNode };
  return {
    path: deployed.path || ctx.path,
    referencePageId: deployed.referencePageId || '',
    pageVersionId: deployed.pageVersionId || 0,
    layout: compiled.layout || null
  };
}

/**
 * Fetch the app shell for a page, or null when the page stands alone.
 *
 * A published app can render its pages inside a *shell* — an ordinary PAGE
 * whose layout contains a `router-outlet` node. The shell is where the navbar
 * and sidebar live, and it is unreachable from the content page: the content
 * page does not reference its own container, so no amount of symbol recursion
 * finds it. It has to be looked up separately, by the first path segment.
 *
 * Two things this must NOT do, both learned the hard way:
 *
 *   - assume the first segment is a shell. On some domains no page has an
 *     outlet at all and every page stands alone.
 *   - look for the outlet in the DOM. The rendered page also contains
 *     Angular's own app-level `<router-outlet>` elements, which have nothing
 *     to do with Page Designer. The outlet is only meaningful in the config.
 *
 * @returns {Promise<PageConfig | null>}
 */
export async function fetchShellConfig(ctx: PageContext, pagePath: string): Promise<PageConfig | null> {
  const firstSegment = ctx.path.split('/').filter(Boolean)[0];
  // A single-segment page IS the first segment — it cannot be its own shell.
  if (!firstSegment || firstSegment === pagePath || firstSegment === ctx.path) {
    return null;
  }

  let deployed;
  try {
    deployed = await fetchDeployable(ctx, 'PAGE', firstSegment);
  } catch (err) {
    log.debug('no app shell (fetch failed):', err);
    return null; // a missing shell must never fail the whole build
  }
  if (!deployed) return null;

  let compiled: { layout?: RawLayoutNode };
  try {
    compiled = JSON.parse(deployed.compiledConfig);
  } catch (err) {
    log.warn('app shell config is not valid JSON:', err);
    return null;
  }
  const layout = compiled.layout || null;
  if (!layout || !hasOutlet(layout)) return null;

  return {
    path: deployed.path || firstSegment,
    referencePageId: deployed.referencePageId || '',
    pageVersionId: deployed.pageVersionId || 0,
    layout
  };
}

/** Fetch + parse one PD component's compiled config by name. */
export async function fetchComponentConfig(ctx: PageContext, name: string): Promise<ComponentConfig> {
  const deployed = await fetchDeployable(ctx, 'COMPONENT', name);
  if (!deployed) throw new Error(`component not found: ${name}`);

  const compiled = JSON.parse(deployed.compiledConfig) as { layout?: RawLayoutNode };
  return {
    name: deployed.path || name,
    referencePageId: deployed.referencePageId || '',
    layout: compiled.layout || null
  };
}

/**
 * Recursively fetch every PD component embedded (directly or transitively) in
 * a page. Returns a name -> ComponentConfig map. A failed fetch is recorded as
 * a stub so one bad component cannot break the whole graph.
 *
 * Pass `into` to accumulate into an existing map, so a shell and its content
 * page share one graph and fetch each component once.
 */
export async function fetchComponentGraph(
  ctx: PageContext,
  pageLayout: RawLayoutNode | null,
  into?: ComponentGraph
): Promise<ComponentGraph> {
  const map: ComponentGraph = into || new Map();
  const queue = collectSymbolNames(pageLayout);

  while (queue.length) {
    const name = queue.shift()!;
    if (map.has(name)) continue;
    try {
      const cfg = await fetchComponentConfig(ctx, name);
      map.set(name, cfg);
      for (const child of collectSymbolNames(cfg.layout)) {
        if (!map.has(child)) queue.push(child);
      }
    } catch (err) {
      log.warn(`component "${name}" could not be fetched:`, err);
      // One bad component cannot break the whole graph — record a stub.
      map.set(name, {
        name,
        referencePageId: '',
        layout: null,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return map;
}
