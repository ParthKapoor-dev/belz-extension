// Component-nesting tree.
//
// Built purely from compiled configs (no DOM) — so it is exact: it shows
// precisely which PD components a page embeds, and how they nest. Each entry
// also carries its own config node tree (with visibility conditions) so the
// panel can show what is inside a component, including conditionally-hidden
// nodes.

import { buildTree, summarize } from './tree';
import { collectChildRefs } from './config';
import type {
  ComponentGraph,
  ComponentKind,
  ComponentTreeNode,
  PageConfig,
  RawLayoutNode
} from './types';

interface NodeSpec {
  name: string;
  layout: RawLayoutNode | null;
  referencePageId: string;
  kind: ComponentKind;
  error?: string | null;
  /** Builds the content page, for the shell's outlet. */
  outlet?: () => ComponentTreeNode;
}

/**
 * Build the component-nesting tree for a page, optionally inside its app shell.
 *
 * With a shell, the content page is spliced in at the shell's outlet — the same
 * place the runtime puts it — so the tree matches what is actually on screen,
 * navbar and sidebar included. Without one, this is the page tree alone.
 */
export function buildComponentTree(
  pageConfig: PageConfig,
  graph: ComponentGraph,
  shellConfig: PageConfig | null
): ComponentTreeNode {
  // `ancestors` guards the path from the root: a component may appear several
  // times as a sibling, but must not expand inside itself (a true cycle).
  const make = (spec: NodeSpec, ancestors: ReadonlySet<string>): ComponentTreeNode => {
    const nodeTree = spec.layout ? buildTree(spec.layout) : null;
    const node: ComponentTreeNode = {
      name: spec.name,
      kind: spec.kind,
      // Retained so callers that only care "is this a page or a component"
      // keep working; a shell is a page.
      isPage: spec.kind !== 'component',
      referencePageId: spec.referencePageId || '',
      nodeTree,
      nodeSummary: nodeTree ? summarize(nodeTree) : { total: 0, bound: 0, hidden: 0 },
      children: [],
      error: spec.error || null
    };

    if (spec.layout && !ancestors.has(spec.name)) {
      const nextAncestors = new Set(ancestors).add(spec.name);
      for (const ref of collectChildRefs(spec.layout)) {
        if (ref.type === 'outlet') {
          // Only the shell has an outlet, and only one page renders into it.
          if (spec.outlet) node.children.push(spec.outlet());
          continue;
        }
        const cc = graph.get(ref.name);
        node.children.push(
          cc
            ? make({ name: cc.name, layout: cc.layout, referencePageId: cc.referencePageId, kind: 'component', error: cc.error }, nextAncestors)
            : make({ name: ref.name, layout: null, referencePageId: '', kind: 'component', error: 'component not fetched' }, nextAncestors)
        );
      }
    }
    return node;
  };

  const buildPage = () =>
    make({ name: pageConfig.path, layout: pageConfig.layout, referencePageId: pageConfig.referencePageId, kind: 'page' }, new Set());

  if (!shellConfig) return buildPage();

  return make(
    { name: shellConfig.path, layout: shellConfig.layout, referencePageId: shellConfig.referencePageId, kind: 'shell', outlet: buildPage },
    new Set()
  );
}

/** Flatten unique component names embedded in the tree (excludes pages/shell). */
export function componentNames(root: ComponentTreeNode): string[] {
  const names = new Set<string>();
  const walk = (n: ComponentTreeNode) => {
    if (n.kind === 'component') names.add(n.name);
    n.children.forEach(walk);
  };
  walk(root);
  return [...names];
}
