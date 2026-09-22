// PD Inspector content-script engine.
//
// Runs on published /pages/* pages. It fetches the shell + page + component
// configs, builds the component-nesting tree and the className anchor index,
// and answers commands from the DevTools "PD Inspector" panel. Inspect mode
// (point at the page, identify the owning PD component) runs here because the
// highlighting must happen on the page.
//
// Messaging: the panel calls in via chrome.tabs.sendMessage; the engine pushes
// pick events back out via chrome.runtime.sendMessage. All messages are tagged
// `ns: 'pd'`.

import {
  getPageContext,
  fetchPageConfig,
  fetchShellConfig,
  fetchComponentGraph
} from './config';
import { buildComponentTree, componentNames } from './component-tree';
import { buildConfigIndex, createResolver, type Resolver } from './resolve';
import { createHighlighter, type Highlighter } from './highlight';
import { isPdCommand, type PdCommand, type PdPickMessage } from '../shared/messages';
import type {
  ComponentTreeNode,
  EngineState,
  PageContext,
  SerializedComponentNode,
  SerializedTreeNode,
  TreeNode
} from './types';

let STATE: EngineState = { status: 'loading' };
let resolver: Resolver | null = null;
let highlighter: Highlighter | null = null;
let inspecting = false;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Drop the heavy `raw` config object from a node tree before messaging. */
function stripNodeTree(node: TreeNode | null): SerializedTreeNode | null {
  if (!node) return null;
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    label: node.label,
    fieldName: node.fieldName,
    visibility: node.visibility,
    depth: node.depth,
    children: node.children.map((c) => stripNodeTree(c)!)
  };
}

/** Make the component tree structured-clone friendly (no `raw`). */
function serializeComponentTree(node: ComponentTreeNode): SerializedComponentNode {
  return {
    name: node.name,
    kind: node.kind,
    isPage: node.isPage,
    referencePageId: node.referencePageId,
    nodeTree: stripNodeTree(node.nodeTree),
    nodeSummary: node.nodeSummary,
    error: node.error,
    children: node.children.map(serializeComponentTree)
  };
}

async function build(ctx: PageContext): Promise<void> {
  STATE = { status: 'loading' };
  // A stale resolver answering from the previous route is worse than no
  // answer, so inspect mode goes quiet until this build finishes.
  resolver = null;

  const pageConfig = await fetchPageConfig(ctx);
  const shellConfig = await fetchShellConfig(ctx, pageConfig.path);

  // One graph shared by shell and page, so a component embedded in both
  // (a style or nav symbol, typically) is fetched once.
  const graph = await fetchComponentGraph(ctx, pageConfig.layout);
  if (shellConfig) await fetchComponentGraph(ctx, shellConfig.layout, graph);

  const componentTree = buildComponentTree(pageConfig, graph, shellConfig);
  // Indexed from the shell when there is one, descending into the outlet, so
  // the index covers everything the browser actually renders.
  const index = shellConfig
    ? buildConfigIndex(shellConfig, graph, pageConfig)
    : buildConfigIndex(pageConfig, graph, null);
  resolver = createResolver(index);
  resolver.rebuild(); // so the panel can report real numbers immediately
  const anchorStats = resolver.getStats();

  STATE = {
    status: 'ready',
    pageInfo: {
      host: ctx.host,
      path: pageConfig.path,
      env: ctx.env,
      referencePageId: pageConfig.referencePageId,
      pageVersionId: pageConfig.pageVersionId,
      shellPath: shellConfig ? shellConfig.path : '',
      shellReferencePageId: shellConfig ? shellConfig.referencePageId : '',
      componentCount: componentNames(componentTree).length,
      configNodes: index.nodes.length,
      anchors: anchorStats
    },
    componentTree: serializeComponentTree(componentTree)
  };
}

// ---- inspect mode ----------------------------------------------------------

function onMove(e: MouseEvent): void {
  if (!resolver || !highlighter) return;
  const hit = resolver.resolve(e.target as Element);
  if (!hit) {
    highlighter.hide();
    return;
  }
  // The node label says WHICH config node, not just which component — the old
  // scheme could only ever name a whole form-builder region.
  const node = hit.node.className
    ? `<${hit.node.name} class="${hit.node.className}">`
    : `<${hit.node.name}>`;
  highlighter.show(
    [hit.anchorEl],
    hit.owner + (hit.exact ? '' : '  (nearest match)'),
    `${hit.chain.join('  ›  ')}    ${node}`
  );
}

function onClick(e: MouseEvent): void {
  if (!resolver) return;
  const hit = resolver.resolve(e.target as Element);
  if (!hit) return;
  e.preventDefault();
  e.stopPropagation();
  const pick: PdPickMessage = { ns: 'pd', type: 'pick', chain: hit.chain, nodeName: hit.node.name };
  chrome.runtime.sendMessage(pick);
}

function setInspect(on: boolean): void {
  if (on === inspecting) return;
  inspecting = on;
  if (on) {
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
  } else {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    highlighter?.hide();
  }
}

// ---- panel command handling ------------------------------------------------

function handleCommand(msg: PdCommand, sendResponse: (response: unknown) => void): void {
  switch (msg.cmd) {
    case 'getState':
      sendResponse(STATE);
      return;
    case 'setInspect':
      setInspect(!!msg.on);
      sendResponse({ ok: true, inspecting });
      return;
    case 'highlightComponent': {
      if (!resolver || !highlighter) {
        sendResponse({ ok: false, reason: 'not ready' });
        return;
      }
      const els = resolver.elementsForComponent(msg.name);
      if (els.length) {
        els[0]!.scrollIntoView({ block: 'center', behavior: 'smooth' });
        highlighter.show(els, msg.name, `${els.length} region(s)`);
      } else {
        highlighter.hide();
      }
      sendResponse({ ok: true, count: els.length });
      return;
    }
    case 'clearHighlight':
      highlighter?.hide();
      sendResponse({ ok: true });
      return;
    default:
      sendResponse({ ok: false, reason: 'unknown command' });
  }
}

// ---- lifecycle -------------------------------------------------------------

export function startEngine(): void {
  const ctx = getPageContext();
  if (!ctx) return;

  highlighter = createHighlighter();

  build(ctx).catch((err: unknown) => {
    STATE = { status: 'error', error: errorText(err) };
  });

  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (!isPdCommand(msg)) return false;
    handleCommand(msg, sendResponse);
    return true; // responses may be produced synchronously, but keep the port open
  });

  // Published pages are SPAs — rebuild when the route changes.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    setInspect(false);
    const next = getPageContext();
    if (next) {
      build(next).catch((err: unknown) => {
        STATE = { status: 'error', error: errorText(err) };
      });
    }
  }, 1500);
}
