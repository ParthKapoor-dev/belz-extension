// "PD Inspector" DevTools panel.
//
// The UI half of the PD Inspector. It talks to the page-side engine
// (src/pd-inspector, a content script) over chrome messaging: it pulls the
// component-nesting tree to display, drives inspect mode, and highlights a
// component on the page when one is selected here.
//
// Firefox does not give DevTools panel scripts access to `chrome.tabs`, so
// the panel cannot message the page or open tabs directly. Both go through
// the background relay (src/background/index.ts) via `chrome.runtime`
// messaging, which works in both Chromium and Firefox.

import { KIND_BADGE } from '../../pd-inspector/tree';
import { pdPagePath, pdSymbolPath } from '../../config/endpoints';
import { watchFocusFlag } from '../../shared/focus-flag';
import { required } from '../../shared/dom';
import { createLogger } from '../../shared/logger';
import { isPdPick, type PdCommand, type PdRelayMessage } from '../../shared/messages';
import type {
  ComponentKind,
  EngineState,
  PageInfo,
  SerializedComponentNode,
  SerializedTreeNode
} from '../../pd-inspector/types';

const log = createLogger('pd-panel');

/** How often, and how many times, to re-ask an engine that is still loading. */
const LOADING_RETRY_MS = 400;
const LOADING_MAX_ATTEMPTS = 12;
/** How long the focus shortcut pulses the panel. */
const FOCUS_FLASH_MS = 900;

const BADGE: Record<ComponentKind, string> = { shell: 'SHELL', page: 'PAGE', component: 'COMP' };

function el(tag: string, cls?: string | null, text?: string | null): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function kindBadge(node: SerializedComponentNode): HTMLElement {
  const kind: ComponentKind = node.kind || (node.isPage ? 'page' : 'component');
  return el('span', `badge ${kind === 'component' ? 'comp' : 'page'}`, BADGE[kind]);
}

/** One config node of a component's layout, and its children, collapsible. */
function renderNode(n: SerializedTreeNode, container: HTMLElement): void {
  const row = el('div', 'node');
  row.style.paddingLeft = `${10 + n.depth * 12}px`;

  const caret = el('span', 'caret');
  const hasKids = n.children.length > 0;
  caret.textContent = hasKids ? '▾' : '';
  if (!hasKids) caret.classList.add('leaf');
  row.appendChild(caret);

  row.appendChild(el('span', `nbadge k-${n.kind}`, KIND_BADGE[n.kind] || n.kind));
  const label = el('span', 'nlabel', n.label);
  label.title = `${n.name} · ${n.id}`;
  row.appendChild(label);

  const visibility = n.visibility;
  if (visibility.kind === 'bound') {
    const v = el('span', 'vis bound', '◑ cond');
    v.title = visibility.expr;
    row.appendChild(v);
  } else if (visibility.kind === 'static-hidden') {
    row.appendChild(el('span', 'vis hidden', '⊘ hidden'));
  }
  container.appendChild(row);

  if (visibility.kind === 'bound' && visibility.expr) {
    const expr = el('div', 'expr', `visible if  ${visibility.expr}`);
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
  private readonly tabId = chrome.devtools.inspectedWindow.tabId;
  private readonly body = required('#body');
  private readonly inspectBtn = required<HTMLButtonElement>('#inspect');
  private readonly refreshBtn = required<HTMLButtonElement>('#refresh');

  private inspecting = false;
  private pageInfo: PageInfo | null = null;
  /** name -> first .comp row element, for pick-driven selection. */
  private readonly compRows = new Map<string, HTMLElement>();
  /** Bumped per load, so a retry loop from an earlier load stops. */
  private loadGeneration = 0;

  start(): void {
    chrome.runtime.onMessage.addListener((msg: unknown) => {
      if (isPdPick(msg)) this.onPick(msg.chain);
    });
    this.inspectBtn.addEventListener('click', () => {
      this.setInspecting(!this.inspecting);
      this.callEngine({ ns: 'pd', cmd: 'setInspect', on: this.inspecting });
    });
    this.refreshBtn.addEventListener('click', () => this.reload());
    chrome.devtools.network.onNavigated.addListener(() => this.reload());
    // Ctrl+Shift+P: re-fetch the tree (like a refresh click) and pulse the
    // panel so the user sees it react.
    watchFocusFlag('pd', () => {
      this.load();
      document.body.classList.add('focus-flash');
      setTimeout(() => document.body.classList.remove('focus-flash'), FOCUS_FLASH_MS);
    });
    this.load();
  }

  private reload(): void {
    this.setInspecting(false);
    this.load();
  }

  private setInspecting(on: boolean): void {
    this.inspecting = on;
    this.inspectBtn.classList.toggle('on', on);
    this.inspectBtn.textContent = on ? 'Inspecting…' : 'Inspect';
  }

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
    chrome.runtime.sendMessage(message);
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
    void this.loadAttempt(++this.loadGeneration, 0);
  }

  private async loadAttempt(generation: number, attempt: number): Promise<void> {
    const state = await this.callEngine<EngineState>({ ns: 'pd', cmd: 'getState' });
    if (generation !== this.loadGeneration) return; // a newer load took over
    if (!state) {
      this.showNotice(
        'Open a published page (…/pages/…) in this tab. If you just installed ' +
          'or reloaded the extension, reload the page once so the inspector loads.'
      );
      return;
    }
    if (state.status === 'loading') {
      if (attempt < LOADING_MAX_ATTEMPTS) {
        setTimeout(() => this.loadAttempt(generation, attempt + 1), LOADING_RETRY_MS);
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
    this.body.replaceChildren(el('div', 'notice', text));
    this.inspectBtn.disabled = true;
  }

  // ---- rendering -----------------------------------------------------------

  private render(info: PageInfo, tree: SerializedComponentNode): void {
    this.compRows.clear();

    const split = el('div', 'split');
    const treePane = el('div', 'pane-tree');
    treePane.id = 'tree';
    const detailPane = el('div', 'pane-detail');
    detailPane.id = 'detail';
    detailPane.appendChild(el('div', 'detail-empty', 'Select a component to see its layout.'));
    split.append(treePane, detailPane);

    this.body.replaceChildren(this.buildInfo(info), split);
    this.renderComponent(tree, treePane, 0, detailPane);
  }

  private buildInfo(info: PageInfo): HTMLElement {
    const box = el('div', 'info');
    const row = (k: string, vNode: HTMLElement) => {
      const r = el('div', 'row');
      r.append(el('span', 'k', k), vNode);
      return r;
    };
    box.appendChild(row('Path', el('span', 'v', info.path)));
    box.appendChild(row('Env', el('span', 'v', info.env)));

    // Only shown when the app renders its pages inside a shell — the shell is
    // where the navbar and sidebar come from, and it is a separate PD page.
    if (info.shellPath) {
      const v = el('span', info.shellReferencePageId ? 'v link' : 'v', info.shellPath);
      if (info.shellReferencePageId) {
        v.title = 'Open the app shell in Page Designer';
        v.addEventListener('click', () => this.openInPd(pdPagePath(info.shellReferencePageId)));
      }
      box.appendChild(row('Shell', v));
    }

    if (info.referencePageId) {
      const v = el('span', 'v link', info.referencePageId);
      v.title = 'Open this page in Page Designer';
      v.addEventListener('click', () => this.openInPd(pdPagePath(info.referencePageId)));
      box.appendChild(row('PD page', v));
    }
    box.appendChild(row('Components', el('span', 'v', String(info.componentCount))));

    // Anchors are className matches between the config and the live DOM —
    // facts, not inference. `exact` means one config node and one element
    // carried that className; `positional` means several competed and were
    // paired in document order, which is right when all of them rendered.
    const a = info.anchors;
    if (a) {
      const v = el(
        'span',
        `v ${a.anchored ? 'ok' : 'warn'}`,
        `${a.anchored} of ${info.configNodes} nodes  (${a.exact} exact, ${a.positional} positional)`
      );
      v.title =
        'Elements pinned to a config node by className. Hovering resolves to the ' +
        'nearest pinned ancestor.';
      box.appendChild(row('Anchors', v));
    }

    const picked = el('div', 'row');
    picked.id = 'picked-row';
    picked.style.display = 'none';
    picked.append(el('span', 'k', 'Picked'), el('span', 'v warn', ''));
    box.appendChild(picked);
    return box;
  }

  private renderComponent(
    node: SerializedComponentNode,
    container: HTMLElement,
    depth: number,
    detailPane: HTMLElement
  ): void {
    const rowWrap = el('div');
    const row = el('div', 'comp');
    row.style.paddingLeft = `${8 + depth * 14}px`;

    row.appendChild(kindBadge(node));
    row.appendChild(el('span', 'cname', node.name));

    if (node.error) {
      const e = el('span', 'csum warn', '!');
      e.title = node.error;
      row.appendChild(e);
    } else {
      const s = node.nodeSummary;
      row.appendChild(el('span', 'csum', `${s.total}n·${s.bound}c`));
    }

    const open = el('span', 'openpd', '↗ PD');
    open.title = 'Open in Page Designer';
    open.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openNode(node);
    });
    row.appendChild(open);

    row.addEventListener('click', () => this.selectComponent(node, row, detailPane));
    rowWrap.appendChild(row);
    if (!this.compRows.has(node.name)) this.compRows.set(node.name, row);

    node.children.forEach((child) => this.renderComponent(child, rowWrap, depth + 1, detailPane));
    container.appendChild(rowWrap);
  }

  private selectComponent(node: SerializedComponentNode, row: HTMLElement, detailPane: HTMLElement): void {
    document.querySelectorAll('.comp.sel').forEach((r) => r.classList.remove('sel'));
    row.classList.add('sel');
    this.renderDetail(node, detailPane);
    if (!node.isPage) this.callEngine({ ns: 'pd', cmd: 'highlightComponent', name: node.name });
  }

  /** A component's config node tree. */
  private renderDetail(node: SerializedComponentNode, detailPane: HTMLElement): void {
    detailPane.replaceChildren();
    const head = el('div', 'detail-head');
    head.appendChild(kindBadge(node));
    head.appendChild(el('span', 'nm', node.name));
    const open = el('span', 'openpd', '↗ open in PD');
    open.addEventListener('click', () => this.openNode(node));
    head.appendChild(open);
    detailPane.appendChild(head);

    if (node.error) {
      detailPane.appendChild(el('div', 'detail-empty', `Config unavailable: ${node.error}`));
      return;
    }
    if (!node.nodeTree) {
      detailPane.appendChild(el('div', 'detail-empty', 'No layout in this component.'));
      return;
    }
    const s = node.nodeSummary;
    detailPane.appendChild(
      el('div', 'detail-empty', `${s.total} nodes · ${s.bound} conditional · ${s.hidden} hidden`)
    );
    renderNode(node.nodeTree, detailPane);
  }

  // ---- inspect-mode picks --------------------------------------------------

  private onPick(chain: string[]): void {
    const pickedRow = document.getElementById('picked-row');
    const pickedValue = pickedRow?.querySelector('.v');
    if (pickedRow && pickedValue) {
      pickedRow.style.display = 'flex';
      pickedValue.textContent = chain.join('  ›  ');
    }
    const inner = chain[chain.length - 1];
    document.querySelectorAll('.comp.picked').forEach((r) => r.classList.remove('picked'));
    const row = inner ? this.compRows.get(inner) : undefined;
    if (row) {
      row.classList.add('picked');
      row.scrollIntoView({ block: 'nearest' });
      row.click();
    }
  }
}
