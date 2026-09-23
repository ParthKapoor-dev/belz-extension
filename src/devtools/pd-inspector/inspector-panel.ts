// "PD Inspector" DevTools panel.
//
// The UI half of the PD Inspector. It talks to the page-side engine
// (src/pd-inspector-page, a content script) over chrome messaging: it pulls the
// component-nesting tree to display, drives inspect mode, and highlights a
// component on the page when one is selected here.
//
// Firefox does not give DevTools panel scripts access to `chrome.tabs`, so
// the panel cannot message the page or open tabs directly. Both go through
// the background relay (src/background/relay.ts) via `chrome.runtime`
// messaging, which works in both Chromium and Firefox.
//
// Inspect mode lives in the page and swallows its clicks, so the panel keeps
// it alive only while it is itself alive: a heartbeat every
// TIMINGS.pdInspectHeartbeat while inspecting (the engine drops inspect mode
// when the beats stop), an explicit "inspect off" before any reload, and
// another from stop(), which also runs when the panel page is hidden.

import { KIND_BADGE } from '../../pd-inspector-page/tree';
import { pdPagePath, pdSymbolPath } from '../../config/endpoints';
import { TIMINGS } from '../../config/timings';
import { watchFocusFlag } from '../../shared/focus-flag';
import { required } from '../../shared/dom';
import { createLogger } from '../../shared/logger';
import {
  isFromExtension,
  isPdPick,
  isPdRouteChanged,
  type PdCommand,
  type PdRelayMessage
} from '../../shared/messages';
import { el, FocusFlash } from '../view';
import type {
  ComponentKind,
  EngineState,
  PageInfo,
  SerializedComponentNode,
  SerializedTreeNode
} from '../../pd-inspector-page/types';

const log = createLogger('pd-panel');

/** How often, and how many times, to re-ask an engine that is still loading. */
const LOADING_RETRY_MS = 400;
const LOADING_MAX_ATTEMPTS = 12;

/** The panel's elements, from panel.html. */
function panelElements() {
  return {
    /** The panel's own root: everything it renders lives in here. */
    body: required('#body'),
    inspect: required<HTMLButtonElement>('#inspect'),
    refresh: required<HTMLButtonElement>('#refresh')
  };
}

/** Ids of the panel's own rendered elements. */
const TREE_ID = 'tree';
const DETAIL_ID = 'detail';
const PICKED_ROW_ID = 'picked-row';

const BADGE: Record<ComponentKind, string> = { shell: 'SHELL', page: 'PAGE', component: 'COMP' };

function kindBadge(node: SerializedComponentNode): HTMLElement {
  const kind: ComponentKind = node.kind || (node.isPage ? 'page' : 'component');
  return el('span', { className: `badge ${kind === 'component' ? 'comp' : 'page'}` }, BADGE[kind]);
}

/** One config node of a component's layout, and its children, collapsible. */
function renderNode(n: SerializedTreeNode, container: HTMLElement): void {
  const row = el('div', { className: 'node' });
  row.style.paddingLeft = `${10 + n.depth * 12}px`;

  const caret = el('span', { className: 'caret' });
  const hasKids = n.children.length > 0;
  caret.textContent = hasKids ? '▾' : '';
  if (!hasKids) caret.classList.add('leaf');
  row.appendChild(caret);

  row.appendChild(el('span', { className: `nbadge k-${n.kind}` }, KIND_BADGE[n.kind] || n.kind));
  row.appendChild(el('span', { className: 'nlabel', title: `${n.name} · ${n.id}` }, n.label));

  const visibility = n.visibility;
  if (visibility.kind === 'bound') {
    row.appendChild(el('span', { className: 'vis bound', title: visibility.expr }, '◑ cond'));
  } else if (visibility.kind === 'static-hidden') {
    row.appendChild(el('span', { className: 'vis hidden' }, '⊘ hidden'));
  }
  container.appendChild(row);

  if (visibility.kind === 'bound' && visibility.expr) {
    const expr = el('div', { className: 'expr' }, `visible if  ${visibility.expr}`);
    expr.style.display = 'none';
    container.appendChild(expr);
    row.addEventListener('click', () => {
      expr.style.display = expr.style.display === 'none' ? 'block' : 'none';
    });
  }

  if (hasKids) {
    const kids = el('div');
    n.children.forEach((c) => renderNode(c, kids));
    container.appendChild(kids);
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      const hidden = kids.style.display === 'none';
      kids.style.display = hidden ? 'block' : 'none';
      caret.textContent = hidden ? '▾' : '▸';
    });
  }
}

export class PdInspectorPanel {
  /** The inspected tab and the panel's elements: read by start(), not before. */
  private tabId = -1;
  private body!: HTMLElement;
  private inspectBtn!: HTMLButtonElement;
  private refreshBtn!: HTMLButtonElement;

  private started = false;
  private inspecting = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pageInfo: PageInfo | null = null;
  /** The detail pane of the current render; null before the first. */
  private detailPane: HTMLElement | null = null;
  /** name -> first .comp row element, for pick-driven selection. */
  private readonly compRows = new Map<string, HTMLElement>();
  /** Bumped per load, so a retry loop from an earlier load stops. */
  private loadGeneration = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flash = new FocusFlash();
  private unwatchFocus: (() => void) | null = null;

  /**
   * @param heartbeatMs How often "inspect on" is re-sent while inspecting;
   *   TIMINGS.pdInspectHeartbeat unless a test passes its own.
   */
  constructor(private readonly heartbeatMs: number = TIMINGS.pdInspectHeartbeat) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.tabId = chrome.devtools.inspectedWindow.tabId;
    const els = panelElements();
    this.body = els.body;
    this.inspectBtn = els.inspect;
    this.refreshBtn = els.refresh;
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    window.addEventListener('pagehide', this.onPageHide);
    this.inspectBtn.addEventListener('click', this.onInspectClick);
    this.refreshBtn.addEventListener('click', this.reload);
    chrome.devtools.network.onNavigated.addListener(this.reload);
    this.unwatchFocus = watchFocusFlag('pd', this.onFocusShortcut);
    this.load();
  }

  stop(): void {
    if (!this.started) return;
    // Before `started` goes false: leave inspect mode on the page too.
    this.leaveInspect();
    this.started = false;
    chrome.runtime.onMessage.removeListener(this.onRuntimeMessage);
    window.removeEventListener('pagehide', this.onPageHide);
    this.inspectBtn.removeEventListener('click', this.onInspectClick);
    this.refreshBtn.removeEventListener('click', this.reload);
    chrome.devtools.network.onNavigated.removeListener(this.reload);
    this.unwatchFocus?.();
    this.unwatchFocus = null;
    this.loadGeneration++; // an answer still on its way is dropped
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.flash.cancel();
  }

  // ---- handlers ------------------------------------------------------------

  private readonly onRuntimeMessage = (msg: unknown, sender: chrome.runtime.MessageSender): void => {
    // Only this extension's engine, in the tab this DevTools window inspects.
    if (!isFromExtension(sender) || sender.tab?.id !== this.tabId) return;
    if (isPdPick(msg)) this.onPick(msg.chain);
    else if (isPdRouteChanged(msg)) this.reload();
  };

  // The button shows what the engine says, not what was asked: an engine
  // that did not answer (no published page, reloaded) is not inspecting.
  private readonly onInspectClick = async (): Promise<void> => {
    const on = !this.inspecting;
    this.setInspecting(on);
    const resp = await this.callEngine<{ inspecting?: boolean }>({ ns: 'pd', cmd: 'setInspect', on });
    if (!this.started) return;
    this.setInspecting(resp?.inspecting === true);
  };

  /** Refresh, navigation, or an SPA route change: leave inspect mode, reload. */
  private readonly reload = (): void => {
    this.leaveInspect();
    this.load();
  };

  // Ctrl+Shift+P: re-fetch the tree (like a refresh click) and pulse the
  // panel so the user sees it react.
  private readonly onFocusShortcut = (): void => {
    this.leaveInspect();
    this.load();
    this.flash.show(document.body);
  };

  /** The panel is going away (DevTools closing, panel reloading). */
  private readonly onPageHide = (): void => {
    this.stop();
  };

  /** Tell the engine to leave inspect mode (if it was on here), and reset the button. */
  private leaveInspect(): void {
    if (this.inspecting) void this.callEngine({ ns: 'pd', cmd: 'setInspect', on: false });
    this.setInspecting(false);
  }

  private setInspecting(on: boolean): void {
    this.inspecting = on;
    this.inspectBtn.classList.toggle('on', on);
    this.inspectBtn.textContent = on ? 'Inspecting…' : 'Inspect';
    if (on && !this.heartbeat) {
      this.heartbeat = setInterval(this.beat, this.heartbeatMs);
    } else if (!on && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  /** Inspect mode is still wanted: re-arms the engine's watchdog. */
  private readonly beat = (): void => {
    void this.callEngine({ ns: 'pd', cmd: 'setInspect', on: true });
  };

  // ---- engine messaging ----------------------------------------------------

  /** Send a command to the page-side engine; resolves null if it is not there. */
  private callEngine<R = unknown>(payload: PdCommand): Promise<R | null> {
    return new Promise((resolve) => {
      const message: PdRelayMessage = { __pdRelay: 'cmd', tabId: this.tabId, payload };
      try {
        chrome.runtime.sendMessage(message, (resp: R) => {
          const error = chrome.runtime.lastError;
          if (error) log.debug(`engine did not answer "${payload.cmd}":`, error.message);
          resolve(error ? null : resp);
        });
      } catch (err) {
        // Throws once the extension was reloaded under an open panel.
        log.warn('cannot reach the engine:', err);
        resolve(null);
      }
    });
  }

  private openInPd(path: string): void {
    if (!this.pageInfo) return;
    const message: PdRelayMessage = { __pdRelay: 'open', url: `https://${this.pageInfo.host}${path}` };
    try {
      chrome.runtime.sendMessage(message);
    } catch (err) {
      // Throws once the extension was reloaded under an open panel.
      log.warn('cannot open Page Designer:', err);
    }
  }

  /** Open a component-tree node in Page Designer: a page by id, a component by name. */
  private openNode(node: SerializedComponentNode): void {
    if (node.isPage) {
      if (node.referencePageId) this.openInPd(pdPagePath(node.referencePageId));
    } else if (node.name) {
      this.openInPd(pdSymbolPath(node.name));
    }
  }

  // ---- loading -------------------------------------------------------------

  private load(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.loadAttempt(++this.loadGeneration, 0);
  }

  private async loadAttempt(generation: number, attempt: number): Promise<void> {
    const state = await this.callEngine<EngineState>({ ns: 'pd', cmd: 'getState' });
    if (generation !== this.loadGeneration) return; // a newer load took over, or stopped
    if (!state) {
      this.showNotice(
        'Open a published page (…/pages/…) in this tab. If you just installed ' +
          'or reloaded the extension, reload the page once so the inspector loads.'
      );
      return;
    }
    if (state.status === 'loading') {
      if (attempt < LOADING_MAX_ATTEMPTS) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.loadAttempt(generation, attempt + 1);
        }, LOADING_RETRY_MS);
      } else {
        this.showNotice('Still loading the page config…  try Refresh.');
      }
      return;
    }
    if (state.status === 'error') {
      log.warn('engine reported an error:', state.error);
      this.showNotice(`Could not load the page config: ${state.error}`);
      return;
    }
    this.pageInfo = state.pageInfo;
    this.inspectBtn.disabled = false;
    this.render(state.pageInfo, state.componentTree);
  }

  private showNotice(text: string): void {
    this.detailPane = null;
    this.compRows.clear();
    this.body.replaceChildren(el('div', { className: 'notice' }, text));
    this.inspectBtn.disabled = true;
  }

  // ---- rendering -----------------------------------------------------------

  private render(info: PageInfo, tree: SerializedComponentNode): void {
    this.compRows.clear();

    const treePane = el('div', { className: 'pane-tree', id: TREE_ID });
    const detailPane = el(
      'div',
      { className: 'pane-detail', id: DETAIL_ID },
      el('div', { className: 'detail-empty' }, 'Select a component to see its layout.')
    );
    this.detailPane = detailPane;

    this.body.replaceChildren(this.buildInfo(info), el('div', { className: 'split' }, treePane, detailPane));
    this.renderComponent(tree, treePane, 0);
  }

  private buildInfo(info: PageInfo): HTMLElement {
    const box = el('div', { className: 'info' });
    const row = (k: string, vNode: HTMLElement) =>
      el('div', { className: 'row' }, el('span', { className: 'k' }, k), vNode);
    box.appendChild(row('Path', el('span', { className: 'v' }, info.path)));
    box.appendChild(row('Env', el('span', { className: 'v' }, info.env)));

    // Only shown when the app renders its pages inside a shell — the shell is
    // where the navbar and sidebar come from, and it is a separate PD page.
    if (info.shellPath) {
      const v = el('span', { className: info.shellReferencePageId ? 'v link' : 'v' }, info.shellPath);
      if (info.shellReferencePageId) {
        v.title = 'Open the app shell in Page Designer';
        v.addEventListener('click', () => this.openInPd(pdPagePath(info.shellReferencePageId)));
      }
      box.appendChild(row('Shell', v));
    }

    if (info.referencePageId) {
      const v = el('span', { className: 'v link', title: 'Open this page in Page Designer' }, info.referencePageId);
      v.addEventListener('click', () => this.openInPd(pdPagePath(info.referencePageId)));
      box.appendChild(row('PD page', v));
    }
    box.appendChild(row('Components', el('span', { className: 'v' }, String(info.componentCount))));

    // Anchors are className matches between the config and the live DOM —
    // facts, not inference. `exact` means one config node and one element
    // carried that className; `positional` means several competed and were
    // paired in document order, which is right when all of them rendered.
    const a = info.anchors;
    if (a) {
      const v = el(
        'span',
        {
          className: `v ${a.anchored ? 'ok' : 'warn'}`,
          title:
            'Elements pinned to a config node by className. Hovering resolves to the ' +
            'nearest pinned ancestor.'
        },
        `${a.anchored} of ${info.configNodes} nodes  (${a.exact} exact, ${a.positional} positional)`
      );
      box.appendChild(row('Anchors', v));
    }

    const picked = el(
      'div',
      { className: 'row', id: PICKED_ROW_ID },
      el('span', { className: 'k' }, 'Picked'),
      el('span', { className: 'v warn' }, '')
    );
    picked.style.display = 'none';
    box.appendChild(picked);
    return box;
  }

  private renderComponent(node: SerializedComponentNode, container: HTMLElement, depth: number): void {
    const rowWrap = el('div');
    const row = el('div', { className: 'comp' });
    row.style.paddingLeft = `${8 + depth * 14}px`;

    row.appendChild(kindBadge(node));
    row.appendChild(el('span', { className: 'cname' }, node.name));

    if (node.error) {
      row.appendChild(el('span', { className: 'csum warn', title: node.error }, '!'));
    } else {
      const s = node.nodeSummary;
      row.appendChild(el('span', { className: 'csum' }, `${s.total}n·${s.bound}c`));
    }

    const open = el('span', { className: 'openpd', title: 'Open in Page Designer' }, '↗ PD');
    open.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openNode(node);
    });
    row.appendChild(open);

    row.addEventListener('click', () => this.selectComponent(node, row));
    rowWrap.appendChild(row);
    if (!this.compRows.has(node.name)) this.compRows.set(node.name, row);

    node.children.forEach((child) => this.renderComponent(child, rowWrap, depth + 1));
    container.appendChild(rowWrap);
  }

  private selectComponent(node: SerializedComponentNode, row: HTMLElement): void {
    this.body.querySelectorAll('.comp.sel').forEach((r) => r.classList.remove('sel'));
    row.classList.add('sel');
    this.renderDetail(node);
    if (!node.isPage) this.callEngine({ ns: 'pd', cmd: 'highlightComponent', name: node.name });
  }

  /** A component's config node tree, in the detail pane. */
  private renderDetail(node: SerializedComponentNode): void {
    const pane = this.detailPane;
    if (!pane) return;
    const open = el('span', { className: 'openpd' }, '↗ open in PD');
    open.addEventListener('click', () => this.openNode(node));
    pane.replaceChildren(
      el('div', { className: 'detail-head' }, kindBadge(node), el('span', { className: 'nm' }, node.name), open)
    );

    if (node.error) {
      pane.appendChild(el('div', { className: 'detail-empty' }, `Config unavailable: ${node.error}`));
      return;
    }
    if (!node.nodeTree) {
      pane.appendChild(el('div', { className: 'detail-empty' }, 'No layout in this component.'));
      return;
    }
    const s = node.nodeSummary;
    pane.appendChild(
      el('div', { className: 'detail-empty' }, `${s.total} nodes · ${s.bound} conditional · ${s.hidden} hidden`)
    );
    renderNode(node.nodeTree, pane);
  }

  // ---- inspect-mode picks --------------------------------------------------

  private onPick(chain: string[]): void {
    const pickedRow = this.body.querySelector<HTMLElement>(`#${PICKED_ROW_ID}`);
    const pickedValue = pickedRow?.querySelector('.v');
    if (pickedRow && pickedValue) {
      pickedRow.style.display = 'flex';
      pickedValue.textContent = chain.join('  ›  ');
    }
    const inner = chain[chain.length - 1];
    this.body.querySelectorAll('.comp.picked').forEach((r) => r.classList.remove('picked'));
    const row = inner ? this.compRows.get(inner) : undefined;
    if (row) {
      row.classList.add('picked');
      row.scrollIntoView({ block: 'nearest' });
      row.click();
    }
  }
}
