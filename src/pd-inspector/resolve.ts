// DOM -> config-node ownership, anchored on className.
//
// This replaces the old two-tag anchor correlation, which counted
// `exp-form-builder` / `exp-data-table` elements document-wide and zipped them
// against the config by index. That scheme was wrong in principle (the counts
// came from different regions of the page) and useless in practice — the page
// it was written for renders ZERO form-builders.
//
// What actually works, established by measurement on live pages:
//
//   - The runtime emits an `<exp-layout class="exp-layout-use-sibling">` marker
//     before each element it renders, but the marker set is NOT 1:1 with config
//     nodes: it omits whole subtrees that did not render, and adds markers for
//     the runtime's own internal markup. So neither a count nor a positional
//     zip can align the two.
//
//   - A node's static `props.className` DOES survive into the rendered
//     element's class list. That is ground truth, not inference: 168 of 354
//     config nodes on the reference page carry one, and they pin 96 elements.
//
// So: use className as anchor points, and answer "who owns this element?" by
// climbing to the nearest anchored ancestor. On the reference page that covers
// 98% of visible elements, against 1 usable anchor before.

import { isSymbolRef, OUTLET_NODE_NAME } from './config';
import type {
  AnchorStats,
  ComponentGraph,
  ConfigIndex,
  IndexedNode,
  PageConfig,
  RawLayoutNode
} from './types';

/** Which config node an element is pinned to, and how certainly. */
interface Anchor {
  node: IndexedNode;
  /** One node and one element carried this className (vs paired by order). */
  exact: boolean;
}

/** The answer to "who owns this element?". */
export interface ResolveHit {
  /** The anchored element the answer came from: the target or an ancestor. */
  anchorEl: Element;
  node: IndexedNode;
  chain: string[];
  owner: string;
  exact: boolean;
}

export interface Resolver {
  resolve(el: Element): ResolveHit | null;
  elementsForComponent(name: string): Element[];
  rebuild(): void;
  getStats(): AnchorStats;
}

/** Rebuild the anchor map at most this often while the pointer moves. */
const REBUILD_THROTTLE_MS = 500;

/**
 * Flatten the composed config (shell -> outlet -> page, with every symbol
 * expanded) into document-ordered nodes, grouped by className.
 *
 * `rootConfig` is the shell when there is one, else the page; `outletConfig`
 * is the content page spliced in at the shell's outlet.
 */
export function buildConfigIndex(
  rootConfig: Pick<PageConfig, 'path' | 'layout'>,
  graph: Pick<ComponentGraph, 'get'>,
  outletConfig: Pick<PageConfig, 'path' | 'layout'> | null
): ConfigIndex {
  const nodes: IndexedNode[] = [];
  const byClass = new Map<string, IndexedNode[]>();

  const walk = (node: RawLayoutNode | null | undefined, chain: string[]): void => {
    if (!node || typeof node !== 'object') return;
    const name = String(node.name || '');
    const className =
      node.props && typeof node.props.className === 'string'
        ? node.props.className.trim()
        : '';

    const record: IndexedNode = { name, chain, owner: chain[chain.length - 1] ?? '', className };
    nodes.push(record);
    if (className) {
      if (!byClass.has(className)) byClass.set(className, []);
      byClass.get(className)!.push(record);
    }

    if (name === OUTLET_NODE_NAME && outletConfig && outletConfig.layout) {
      walk(outletConfig.layout, chain.concat(outletConfig.path));
      return;
    }
    if (isSymbolRef(node)) {
      if (chain.includes(node.name)) return; // cycle guard
      const cc = graph.get(node.name);
      if (cc && cc.layout) walk(cc.layout, chain.concat(node.name));
      return;
    }
    (node.children || []).forEach((c) => walk(c, chain));
  };

  walk(rootConfig.layout, [rootConfig.path]);
  return { nodes, byClass };
}

/** A className string -> a CSS selector matching all of its tokens. */
function selectorFor(className: string): string {
  const tokens = className.split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  const parts = [];
  for (const token of tokens) {
    // A className can legitimately contain characters that are not valid in a
    // selector (interpolation leftovers, for one). Those tokens are skipped
    // rather than allowed to throw and lose the whole anchor.
    try {
      parts.push('.' + CSS.escape(token));
    } catch {
      return '';
    }
  }
  return parts.join('');
}

/** Build a live resolver over the current DOM. */
export function createResolver(index: ConfigIndex): Resolver {
  let anchors = new Map<Element, Anchor>();
  let builtAt = 0;
  let stats: AnchorStats = { anchored: 0, exact: 0, positional: 0, unresolved: 0 };

  function build(): void {
    const next = new Map<Element, Anchor>();
    let exact = 0;
    let positional = 0;
    let unresolved = 0;

    for (const [className, configNodes] of index.byClass) {
      const selector = selectorFor(className);
      if (!selector) {
        unresolved += configNodes.length;
        continue;
      }

      let elements: Element[];
      try {
        elements = [...document.querySelectorAll(selector)];
      } catch {
        unresolved += configNodes.length;
        continue;
      }
      if (!elements.length) {
        unresolved += configNodes.length;
        continue;
      }

      // One config node, one element: certain.
      if (configNodes.length === 1 && elements.length === 1) {
        next.set(elements[0]!, { node: configNodes[0]!, exact: true });
        exact++;
        continue;
      }

      // Several of either. Pair them in document order ONLY when the counts
      // agree — that means every config node carrying this className rendered,
      // so the i-th of one really is the i-th of the other.
      //
      // When the counts disagree, refuse. A wrong anchor is worse than none:
      // resolution takes the NEAREST anchored ancestor, so a bogus anchor deep
      // in the tree shadows the correct one further up. Measured on the
      // reference page, refusing costs 1% of coverage (98% -> 97%) and fixes
      // ownership for the whole sidebar, which a generic `overflow-hidden`
      // anchor had been misattributing to the shell instead of the header
      // component that contains it.
      if (configNodes.length !== elements.length) {
        unresolved += configNodes.length;
        continue;
      }
      for (let i = 0; i < configNodes.length; i++) {
        const element = elements[i]!;
        if (next.has(element)) continue;
        next.set(element, { node: configNodes[i]!, exact: false });
        positional++;
      }
    }

    anchors = next;
    builtAt = Date.now();
    stats = { anchored: next.size, exact, positional, unresolved };
  }

  function ensureFresh(): void {
    // The page is an SPA and re-renders under us; a stale anchor map points at
    // detached elements. Rebuilding is a query per distinct className, so it is
    // throttled rather than run per pointer move.
    if (!anchors.size || Date.now() - builtAt > REBUILD_THROTTLE_MS) build();
  }

  /** Who owns this element? Climbs to the nearest anchored ancestor. */
  function resolve(el: Element): ResolveHit | null {
    ensureFresh();
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1) {
      const hit = anchors.get(cur);
      if (hit) {
        return {
          anchorEl: cur,
          node: hit.node,
          chain: hit.node.chain,
          owner: hit.node.owner,
          exact: hit.exact
        };
      }
      cur = cur.parentElement;
    }
    return null;
  }

  /** Anchored elements belonging to a component, for highlighting. */
  function elementsForComponent(name: string): Element[] {
    ensureFresh();
    const out: Element[] = [];
    for (const [element, hit] of anchors) {
      // Innermost match only: a parent component's chain contains every
      // descendant's name, so an ancestor test would highlight the whole page.
      if (hit.node.owner === name && element.isConnected) out.push(element);
    }
    return out;
  }

  return {
    resolve,
    elementsForComponent,
    rebuild: build,
    getStats: () => ({ ...stats })
  };
}
