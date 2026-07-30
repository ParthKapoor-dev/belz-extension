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
} from './config.js';
import { buildComponentTree, componentNames } from './componentTree.js';
import { buildConfigIndex, createResolver } from './resolve.js';
import { createHighlighter } from './highlight.js';

/** @type {{status:string, pageInfo?:object, componentTree?:object, error?:string}} */
let STATE = { status: 'loading' };
let resolver = null;
let highlighter = null;
let inspecting = false;

/** Drop the heavy `raw` config object from a node tree before messaging. */
function stripNodeTree(node) {
  if (!node) return null;
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    label: node.label,
    fieldName: node.fieldName,
    visibility: node.visibility,
    depth: node.depth,
    children: node.children.map(stripNodeTree)
  };
}

/** Make the component tree structured-clone friendly (no `raw`). */
function serializeComponentTree(node) {
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

async function build(ctx) {
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

function onMove(e) {
  if (!resolver) return;
  const hit = resolver.resolve(e.target);
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

function onClick(e) {
  if (!resolver) return;
  const hit = resolver.resolve(e.target);
  if (!hit) return;
  e.preventDefault();
  e.stopPropagation();
  chrome.runtime.sendMessage({
    ns: 'pd',
    type: 'pick',
    chain: hit.chain,
    nodeName: hit.node.name
  });
}

function setInspect(on) {
  if (on === inspecting) return;
  inspecting = on;
  if (on) {
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
  } else {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    highlighter.hide();
  }
}

// ---- panel command handling ------------------------------------------------

function handleCommand(msg, sendResponse) {
  switch (msg.cmd) {
    case 'getState':
      sendResponse(STATE);
      return;
    case 'setInspect':
      setInspect(!!msg.on);
      sendResponse({ ok: true, inspecting });
      return;
    case 'highlightComponent': {
      if (!resolver) {
        sendResponse({ ok: false, reason: 'not ready' });
        return;
      }
      const els = resolver.elementsForComponent(msg.name);
      if (els.length) {
        els[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
        highlighter.show(els, msg.name, `${els.length} region(s)`);
      } else {
        highlighter.hide();
      }
      sendResponse({ ok: true, count: els.length });
      return;
    }
    case 'clearHighlight':
      highlighter.hide();
      sendResponse({ ok: true });
      return;
    default:
      sendResponse({ ok: false, reason: 'unknown command' });
  }
}

// ---- lifecycle -------------------------------------------------------------

export function startEngine() {
  const ctx = getPageContext();
  if (!ctx) return;

  highlighter = createHighlighter();

  build(ctx).catch((err) => {
    STATE = { status: 'error', error: String((err && err.message) || err) };
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.ns !== 'pd' || !msg.cmd) return false;
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
      build(next).catch((err) => {
        STATE = { status: 'error', error: String((err && err.message) || err) };
      });
    }
  }, 1500);
}
