// Published-page + component config fetch.
//
// A published app page (/pages/<path>) renders from a compiled Page Designer
// config. That config embeds PD *components* (symbols) by name; each component
// has its own compiled config, fetched recursively here so the panel can show
// the full component-nesting tree.
//
// Everything is served cookie-authed, same-origin, by the deployable endpoint.

import { PD_DEPLOYABLE_PATH as DEPLOYABLE } from '../../config/endpoints.js';
import { PAGES_ROUTE_PREFIX } from '../../config/routes.js';

/** @typedef {{ host: string, path: string, env: string }} PageContext */

/** Pull the env slug out of a verifi/expertly host (e.g. "nsm-dev"). */
function envFromHost(host) {
  const m = host.match(/^([a-z0-9-]+)\./i);
  return m ? m[1] : host;
}

/**
 * Read the published-page context from `location`, or null when the current
 * URL is not a /pages/ app page.
 * @returns {PageContext | null}
 */
export function getPageContext() {
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
export function isSymbolRef(n) {
  return !!(
    n &&
    n.isSymbol &&
    n.name &&
    !(n.children && n.children.length)
  );
}

/** The node an app shell uses to mark where the content page renders. */
export const OUTLET_NODE_NAME = 'router-outlet';

/**
 * Child references of a layout in document order — embedded components, and the
 * outlet where a content page is spliced in.
 *
 * The outlet is reported as a ref so the component tree and the anchor walk can
 * both place the content page at its true position among the shell's own
 * content, rather than appending it.
 *
 * @returns {Array<{type: 'symbol', name: string} | {type: 'outlet'}>}
 */
export function collectChildRefs(layoutRoot) {
  const refs = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (isSymbolRef(n)) {
      refs.push({ type: 'symbol', name: n.name });
      return; // a ref is a leaf; its content lives in its own config
    }
    if (n.name === OUTLET_NODE_NAME) refs.push({ type: 'outlet' });
    (n.children || []).forEach(walk);
  };
  walk(layoutRoot);
  return refs;
}

/** Names of every embedded-component reference in a layout, in document order. */
export function collectSymbolNames(layoutRoot) {
  return collectChildRefs(layoutRoot)
    .filter((r) => r.type === 'symbol')
    .map((r) => r.name);
}

/** True when a layout splices another page in — i.e. it is an app shell. */
export function hasOutlet(layoutRoot) {
  return collectChildRefs(layoutRoot).some((r) => r.type === 'outlet');
}

/** fetch + parse JSON, with retries — rapid sequential fetches drop transiently. */
async function fetchJson(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('fetch failed');
}

/**
 * Fetch one deployable entry by exact path. The endpoint answers 200 with
 * `deployedPages: [null]` (not 404) when nothing is deployed at that path —
 * treated here as "not found".
 */
async function fetchDeployable(ctx, pageType, path) {
  const url =
    `${DEPLOYABLE}?pageType=${pageType}` +
    `&domain=${encodeURIComponent(ctx.host)}` +
    `&path=${encodeURIComponent(path)}`;
  const json = await fetchJson(url);
  const deployed = json && json.deployedPages && json.deployedPages[0];
  return deployed || null;
}

/**
 * Match an app path against a route template. `:param` template segments
 * match any single path segment. Returns the param count (lower is more
 * specific) when it matches, or -1 when it does not.
 */
function matchRoute(appPath, template) {
  const a = appPath.split('/').filter(Boolean);
  const t = template.split('/').filter(Boolean);
  if (a.length !== t.length) return -1;
  let params = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i].charAt(0) === ':') {
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
async function resolveDeployedPath(ctx) {
  const firstSeg = ctx.path.split('/').filter(Boolean)[0] || ctx.path;
  let routes = [];
  try {
    const json = await fetchJson(
      `${DEPLOYABLE}?pageType=PAGE` +
        `&domain=${encodeURIComponent(ctx.host)}` +
        `&path=${encodeURIComponent(firstSeg)}` +
        `&deployableInfo=true`
    );
    let raw = json && json.dynamicRoute;
    if (typeof raw === 'string') raw = JSON.parse(raw);
    if (Array.isArray(raw)) routes = raw;
  } catch {
    return ctx.path; // route table unavailable — fall back to the literal path
  }

  let best = null;
  let bestParams = Infinity;
  for (const r of routes) {
    if (!r || typeof r.path !== 'string') continue;
    const params = matchRoute(ctx.path, r.path);
    if (params >= 0 && params < bestParams) {
      best = r.path;
      bestParams = params;
    }
  }
  return best || ctx.path;
}

/**
 * Compiled config for one published page.
 * @typedef {{
 *   path: string,
 *   referencePageId: string,
 *   pageVersionId: number,
 *   layout: object | null
 * }} PageConfig
 */

/** Fetch + parse the compiled config for the current published page. */
export async function fetchPageConfig(ctx) {
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

  const compiled = JSON.parse(deployed.compiledConfig);
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
 * Two things this must NOT do, both learned the hard way (see RESEARCH.md):
 *
 *   - assume the first segment is a shell. On some domains no page has an
 *     outlet at all and every page stands alone.
 *   - look for the outlet in the DOM. The rendered page also contains
 *     Angular's own app-level `<router-outlet>` elements, which have nothing
 *     to do with Page Designer. The outlet is only meaningful in the config.
 *
 * @returns {Promise<PageConfig | null>}
 */
export async function fetchShellConfig(ctx, pagePath) {
  const firstSegment = ctx.path.split('/').filter(Boolean)[0];
  // A single-segment page IS the first segment — it cannot be its own shell.
  if (!firstSegment || firstSegment === pagePath || firstSegment === ctx.path) {
    return null;
  }

  let deployed;
  try {
    deployed = await fetchDeployable(ctx, 'PAGE', firstSegment);
  } catch {
    return null; // a missing shell must never fail the whole build
  }
  if (!deployed) return null;

  let compiled;
  try {
    compiled = JSON.parse(deployed.compiledConfig);
  } catch {
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

/**
 * Compiled config for one PD component.
 * @typedef {{
 *   name: string,
 *   referencePageId: string,
 *   layout: object | null,
 *   error?: string
 * }} ComponentConfig
 */

/** Fetch + parse one PD component's compiled config by name. */
export async function fetchComponentConfig(ctx, name) {
  const deployed = await fetchDeployable(ctx, 'COMPONENT', name);
  if (!deployed) throw new Error(`component not found: ${name}`);

  const compiled = JSON.parse(deployed.compiledConfig);
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
 * @param {PageContext} ctx
 * @param {object} pageLayout  the page's compiled-config layout root
 * @param {Map<string, ComponentConfig>} [into]  accumulate into an existing map,
 *   so a shell and its content page share one graph and fetch each component once
 * @returns {Promise<Map<string, ComponentConfig>>}
 */
export async function fetchComponentGraph(ctx, pageLayout, into) {
  const map = into || new Map();
  const queue = collectSymbolNames(pageLayout);

  while (queue.length) {
    const name = queue.shift();
    if (map.has(name)) continue;
    try {
      const cfg = await fetchComponentConfig(ctx, name);
      map.set(name, cfg);
      for (const child of collectSymbolNames(cfg.layout)) {
        if (!map.has(child)) queue.push(child);
      }
    } catch (err) {
      // One bad component cannot break the whole graph — record a stub.
      map.set(name, {
        name,
        referencePageId: '',
        layout: null,
        error: String((err && err.message) || err)
      });
    }
  }
  return map;
}
