// Component-nesting tree.
//
// Built purely from compiled configs (no DOM) — so it is exact: it shows
// precisely which PD components a page embeds, and how they nest. Each entry
// also carries its own config node tree (with visibility conditions) so the
// panel can show what is inside a component, including conditionally-hidden
// nodes.

import { buildTree, summarize } from './tree.js';
import { collectChildRefs } from './config.js';

/**
 * A node in the component-nesting tree.
 * @typedef {{
 *   name: string,
 *   kind: 'shell' | 'page' | 'component',
 *   isPage: boolean,
 *   referencePageId: string,
 *   nodeTree: object | null,
 *   nodeSummary: { total: number, bound: number, hidden: number },
 *   children: ComponentTreeNode[],
 *   error: string | null
 * }} ComponentTreeNode
 */

/**
 * Build the component-nesting tree for a page, optionally inside its app shell.
 *
 * With a shell, the content page is spliced in at the shell's outlet — the same
 * place the runtime puts it — so the tree matches what is actually on screen,
 * navbar and sidebar included. Without one, this is the page tree alone.
 *
 * @param {object} pageConfig          from fetchPageConfig
 * @param {Map<string,object>} graph   from fetchComponentGraph
 * @param {object|null} [shellConfig]  from fetchShellConfig
 * @returns {ComponentTreeNode}
 */
export function buildComponentTree(pageConfig, graph, shellConfig) {
  // ancestor-path guard: a component may appear several times as a sibling,
  // but must not expand inside itself (true cycle).
  const make = (name, layout, referencePageId, kind, error, ancestors, outlet) => {
    const nodeTree = layout ? buildTree(layout) : null;
    const node = {
      name,
      kind,
      // Retained so callers that only care "is this a page or a component"
      // keep working; a shell is a page.
      isPage: kind !== 'component',
      referencePageId: referencePageId || '',
      nodeTree,
      nodeSummary: nodeTree
        ? summarize(nodeTree)
        : { total: 0, bound: 0, hidden: 0 },
      children: [],
      error: error || null
    };

    if (layout && !ancestors.has(name)) {
      const nextAncestors = new Set(ancestors).add(name);
      for (const ref of collectChildRefs(layout)) {
        if (ref.type === 'outlet') {
          // Only the shell has an outlet, and only one page renders into it.
          if (outlet) node.children.push(outlet());
          continue;
        }
        const cc = graph.get(ref.name);
        if (cc) {
          node.children.push(
            make(cc.name, cc.layout, cc.referencePageId, 'component', cc.error, nextAncestors)
          );
        } else {
          node.children.push(
            make(ref.name, null, '', 'component', 'component not fetched', nextAncestors)
          );
        }
      }
    }
    return node;
  };

  const buildPage = () =>
    make(
      pageConfig.path,
      pageConfig.layout,
      pageConfig.referencePageId,
      'page',
      null,
      new Set()
    );

  if (!shellConfig) return buildPage();

  return make(
    shellConfig.path,
    shellConfig.layout,
    shellConfig.referencePageId,
    'shell',
    null,
    new Set(),
    buildPage
  );
}

/** Flatten unique component names embedded in the tree (excludes pages/shell). */
export function componentNames(root) {
  const names = new Set();
  const walk = (n) => {
    if (n.kind === 'component') names.add(n.name);
    n.children.forEach(walk);
  };
  walk(root);
  return [...names];
}
