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
import { buildConfigIndex, Resolver } from './resolve';
import { Highlighter } from './highlight';
import { isPdCommand, type PdCommand, type PdPushMessage } from '../shared/messages';
import { TIMINGS } from '../config/timings';
import { createLogger } from '../shared/logger';
import type {
  ComponentTreeNode,
  EngineState,
  PageContext,
  SerializedComponentNode,
  SerializedTreeNode,
  TreeNode
} from './types';

const log = createLogger('pd-inspector');

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Tell the DevTools panel something; it may not be open, which is fine. */
function pushToPanel(message: PdPushMessage): void {
  try {
    // No receiver rejects the returned promise (Chromium): nothing to report.
    const sent = chrome.runtime.sendMessage(message) as Promise<unknown> | undefined;
    if (sent && typeof sent.catch === 'function') sent.catch(() => {});
  } catch (err) {
    // Throws once the extension was reloaded under the page.
    log.debug('cannot reach the panel:', err);
  }
}

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

export class PdEngine {
  private state: EngineState = { status: 'loading' };
  private resolver: Resolver | null = null;
  private readonly highlighter = new Highlighter();
  private inspecting = false;
  /** Bumped per build, so a slow build for an old route cannot overwrite a newer one. */
  private generation = 0;
  private lastPath = '';
  private routeTimer: ReturnType<typeof setInterval> | null = null;

  /** Build for the current page, answer the panel, and follow route changes. */
  start(): void {
    if (this.routeTimer) return;
    const ctx = getPageContext();
    if (!ctx) return;
    this.lastPath = location.pathname;
    this.highlighter.start();
    this.rebuild(ctx);
    chrome.runtime.onMessage.addListener(this.onMessage);
    // Published pages are SPAs — rebuild when the route changes.
    this.routeTimer = setInterval(this.checkRoute, TIMINGS.pdRoutePoll);
  }

  /** Undo start(): stop polling and answering, leave inspect mode, drop the overlay. */
  stop(): void {
    if (this.routeTimer) clearInterval(this.routeTimer);
    this.routeTimer = null;
    chrome.runtime.onMessage.removeListener(this.onMessage);
    this.setInspect(false);
    this.highlighter.stop();
    this.generation++; // an in-flight build is dropped
    this.resolver = null;
    this.state = { status: 'loading' };
  }

  private readonly checkRoute = (): void => {
    if (location.pathname === this.lastPath) return;
    this.lastPath = location.pathname;
    this.setInspect(false);
    const next = getPageContext();
    if (next) {
      this.rebuild(next);
    } else {
      // Not a published page any more: drop any in-flight build for the old
      // route, and the old route's model with it.
      this.generation++;
      this.resolver = null;
      this.state = { status: 'error', error: 'not a published page (…/pages/…)' };
    }
    // The panel still shows the old route's tree, and inspect mode as on.
    pushToPanel({ ns: 'pd', type: 'routeChanged' });
  };

  private rebuild(ctx: PageContext): void {
    const generation = ++this.generation;
    this.build(ctx, generation).catch((err: unknown) => {
      if (generation !== this.generation) return;
      log.warn('building the page model failed:', err);
      this.state = { status: 'error', error: errorText(err) };
    });
  }

  private async build(ctx: PageContext, generation: number): Promise<void> {
    this.state = { status: 'loading' };
    // A stale resolver answering from the previous route is worse than no
    // answer, so inspect mode goes quiet until this build finishes.
    this.resolver = null;

    const pageConfig = await fetchPageConfig(ctx);
    const shellConfig = await fetchShellConfig(ctx, pageConfig.path);

    // One graph shared by shell and page, so a component embedded in both
    // (a style or nav symbol, typically) is fetched once.
    const graph = await fetchComponentGraph(ctx, pageConfig.layout);
    if (shellConfig) await fetchComponentGraph(ctx, shellConfig.layout, graph);
    if (generation !== this.generation) return; // the route moved on meanwhile

    const componentTree = buildComponentTree(pageConfig, graph, shellConfig);
    // Indexed from the shell when there is one, descending into the outlet, so
    // the index covers everything the browser actually renders.
    const index = shellConfig
      ? buildConfigIndex(shellConfig, graph, pageConfig)
      : buildConfigIndex(pageConfig, graph, null);
    const resolver = new Resolver(index);
    resolver.rebuild(); // so the panel can report real numbers immediately
    this.resolver = resolver;

    this.state = {
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
        anchors: resolver.getStats()
      },
      componentTree: serializeComponentTree(componentTree)
    };
    log.debug('page model ready:', this.state.pageInfo);
  }

  // ---- inspect mode --------------------------------------------------------

  private setInspect(on: boolean): void {
    if (on === this.inspecting) return;
    this.inspecting = on;
    if (on) {
      document.addEventListener('mousemove', this.onMove, true);
      document.addEventListener('click', this.onClick, true);
    } else {
      document.removeEventListener('mousemove', this.onMove, true);
      document.removeEventListener('click', this.onClick, true);
      this.highlighter.hide();
    }
  }

  private readonly onMove = (e: MouseEvent): void => {
    if (!this.resolver) return;
    const hit = this.resolver.resolve(e.target as Element);
    if (!hit) {
      this.highlighter.hide();
      return;
    }
    // The label names the config node, not just its component.
    const node = hit.node.className
      ? `<${hit.node.name} class="${hit.node.className}">`
      : `<${hit.node.name}>`;
    this.highlighter.show(
      [hit.anchorEl],
      hit.owner + (hit.exact ? '' : '  (nearest match)'),
      `${hit.chain.join('  ›  ')}    ${node}`
    );
  };

  private readonly onClick = (e: MouseEvent): void => {
    if (!this.resolver) return;
    const hit = this.resolver.resolve(e.target as Element);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    pushToPanel({ ns: 'pd', type: 'pick', chain: hit.chain, nodeName: hit.node.name });
  };

  // ---- panel commands ------------------------------------------------------

  private readonly onMessage = (
    msg: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ): boolean => {
    if (!isPdCommand(msg)) return false;
    this.handleCommand(msg, sendResponse);
    return true; // responses may be produced synchronously, but keep the port open
  };

  private handleCommand(msg: PdCommand, sendResponse: (response: unknown) => void): void {
    switch (msg.cmd) {
      case 'getState':
        sendResponse(this.state);
        return;
      case 'setInspect':
        this.setInspect(!!msg.on);
        sendResponse({ ok: true, inspecting: this.inspecting });
        return;
      case 'highlightComponent': {
        if (!this.resolver) {
          sendResponse({ ok: false, reason: 'not ready' });
          return;
        }
        const els = this.resolver.elementsForComponent(msg.name);
        if (els.length) {
          els[0]!.scrollIntoView({ block: 'center', behavior: 'smooth' });
          this.highlighter.show(els, msg.name, `${els.length} region(s)`);
        } else {
          this.highlighter.hide();
        }
        sendResponse({ ok: true, count: els.length });
        return;
      }
      case 'clearHighlight':
        this.highlighter.hide();
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ ok: false, reason: 'unknown command' });
    }
  }
}
