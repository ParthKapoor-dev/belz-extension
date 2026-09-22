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
import { watchFocusFlag } from '../focus-flag';
import { required } from '../../shared/dom';
import { isPdPick, type PdCommand, type PdRelayMessage } from '../../shared/messages';
import type {
  ComponentKind,
  EngineState,
  PageInfo,
  SerializedComponentNode,
  SerializedTreeNode
} from '../../pd-inspector/types';

const tabId = chrome.devtools.inspectedWindow.tabId;
const bodyEl = required('#body');
const inspectBtn = required<HTMLButtonElement>('#inspect');
const refreshBtn = required<HTMLButtonElement>('#refresh');

/** How often, and how many times, to re-ask an engine that is still loading. */
const LOADING_RETRY_MS = 400;
const LOADING_MAX_ATTEMPTS = 12;

const BADGE: Record<ComponentKind, string> = { shell: 'SHELL', page: 'PAGE', component: 'COMP' };

let inspecting = false;
let pageInfo: PageInfo | null = null;
/** name -> first .comp row element, for pick-driven selection. */
const compRows = new Map<string, HTMLElement>();

// ---- engine messaging ------------------------------------------------------

/** Send a command to the page-side engine; resolves null if it is not there. */
function callEngine<R = unknown>(payload: PdCommand): Promise<R | null> {
  return new Promise((resolve) => {
    const message: PdRelayMessage = { __pdRelay: 'cmd', tabId, payload };
    try {
      chrome.runtime.sendMessage(message, (resp: R) => {
        resolve(chrome.runtime.lastError ? null : resp);
      });
    } catch {
      resolve(null);
    }
  });
}

// ---- DOM helpers -----------------------------------------------------------

function el(tag: string, cls?: string | null, text?: string | null): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function openInPd(kind: 'page' | 'symbol', idOrName: string): void {
  if (!pageInfo || !idOrName) return;
  const base = `https://${pageInfo.host}/ui-designer`;
  const url =
    kind === 'page'
      ? `${base}/page/${idOrName}`
      : `${base}/symbol/${encodeURIComponent(idOrName)}`;
  const message: PdRelayMessage = { __pdRelay: 'open', url };
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    /* ignore */
  }
}

/** Open a component-tree node in Page Designer: a page by id, a component by name. */
function openNode(node: SerializedComponentNode): void {
  if (node.isPage) openInPd('page', node.referencePageId);
  else openInPd('symbol', node.name);
}

// ---- top-level render ------------------------------------------------------

function showNotice(text: string): void {
  bodyEl.replaceChildren(el('div', 'notice', text));
  inspectBtn.disabled = true;
}

async function loadState(attempt = 0): Promise<void> {
  const state = await callEngine<EngineState>({ ns: 'pd', cmd: 'getState' });
  if (!state) {
    showNotice(
      'Open a published page (…/pages/…) in this tab. If you just installed ' +
        'or reloaded the extension, reload the page once so the inspector loads.'
    );
    return;
  }
  if (state.status === 'loading') {
    if (attempt < LOADING_MAX_ATTEMPTS) {
      setTimeout(() => loadState(attempt + 1), LOADING_RETRY_MS);
    } else {
      showNotice('Still loading the page config…  try Refresh.');
    }
    return;
  }
  if (state.status === 'error') {
    showNotice(`Could not load the page config: ${state.error}`);
    return;
  }
  pageInfo = state.pageInfo;
  inspectBtn.disabled = false;
  render(state.pageInfo, state.componentTree);
}

function render(info: PageInfo, tree: SerializedComponentNode): void {
  compRows.clear();

  const split = el('div', 'split');
  const treePane = el('div', 'pane-tree');
  treePane.id = 'tree';
  const detailPane = el('div', 'pane-detail');
  detailPane.id = 'detail';
  detailPane.appendChild(el('div', 'detail-empty', 'Select a component to see its layout.'));
  split.append(treePane, detailPane);

  bodyEl.replaceChildren(buildInfo(info), split);
  renderComponent(tree, treePane, 0, detailPane);
}

function buildInfo(info: PageInfo): HTMLElement {
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
      v.addEventListener('click', () => openInPd('page', info.shellReferencePageId));
    }
    box.appendChild(row('Shell', v));
  }

  if (info.referencePageId) {
    const v = el('span', 'v link', info.referencePageId);
    v.title = 'Open this page in Page Designer';
    v.addEventListener('click', () => openInPd('page', info.referencePageId));
    box.appendChild(row('PD page', v));
  }
  box.appendChild(row('Components', el('span', 'v', String(info.componentCount))));

  // Anchors are className matches between the config and the live DOM — facts,
  // not inference. `exact` means one config node and one element carried that
  // className; `positional` means several competed and were paired in document
  // order, which is right when all of them rendered.
  const a = info.anchors;
  if (a) {
    const v = el(
      'span',
      `v ${a.anchored ? 'ok' : 'warn'}`,
      `${a.anchored} of ${info.configNodes} nodes  (${a.exact} exact, ${a.positional} positional)`
    );
    v.title =
      'Elements pinned to a config node by className. Hovering resolves to the '
      + 'nearest pinned ancestor.';
    box.appendChild(row('Anchors', v));
  }

  const picked = el('div', 'row');
  picked.id = 'picked-row';
  picked.style.display = 'none';
  picked.append(el('span', 'k', 'Picked'), el('span', 'v warn', ''));
  box.appendChild(picked);
  return box;
}

// ---- component tree --------------------------------------------------------

function kindBadge(node: SerializedComponentNode): HTMLElement {
  const kind: ComponentKind = node.kind || (node.isPage ? 'page' : 'component');
  return el('span', `badge ${kind === 'component' ? 'comp' : 'page'}`, BADGE[kind]);
}

function renderComponent(
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
    openNode(node);
  });
  row.appendChild(open);

  row.addEventListener('click', () => selectComponent(node, row, detailPane));
  rowWrap.appendChild(row);
  if (!compRows.has(node.name)) compRows.set(node.name, row);

  node.children.forEach((child) => renderComponent(child, rowWrap, depth + 1, detailPane));
  container.appendChild(rowWrap);
}

function selectComponent(node: SerializedComponentNode, row: HTMLElement, detailPane: HTMLElement): void {
  document.querySelectorAll('.comp.sel').forEach((r) => r.classList.remove('sel'));
  row.classList.add('sel');
  renderDetail(node, detailPane);
  if (!node.isPage) callEngine({ ns: 'pd', cmd: 'highlightComponent', name: node.name });
}

// ---- detail: a component's config node tree --------------------------------

function renderDetail(node: SerializedComponentNode, detailPane: HTMLElement): void {
  detailPane.replaceChildren();
  const head = el('div', 'detail-head');
  head.appendChild(kindBadge(node));
  head.appendChild(el('span', 'nm', node.name));
  const open = el('span', 'openpd', '↗ open in PD');
  open.addEventListener('click', () => openNode(node));
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

// ---- inspect-mode pick events ---------------------------------------------

function onPick(chain: string[]): void {
  const pickedRow = document.getElementById('picked-row');
  const pickedValue = pickedRow?.querySelector('.v');
  if (pickedRow && pickedValue) {
    pickedRow.style.display = 'flex';
    pickedValue.textContent = chain.join('  ›  ');
  }
  const inner = chain[chain.length - 1];
  document.querySelectorAll('.comp.picked').forEach((r) => r.classList.remove('picked'));
  const row = inner ? compRows.get(inner) : undefined;
  if (row) {
    row.classList.add('picked');
    row.scrollIntoView({ block: 'nearest' });
    row.click();
  }
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (isPdPick(msg)) onPick(msg.chain);
});

// ---- controls --------------------------------------------------------------

function resetInspectButton(): void {
  inspecting = false;
  inspectBtn.classList.remove('on');
  inspectBtn.textContent = 'Inspect';
}

inspectBtn.addEventListener('click', async () => {
  inspecting = !inspecting;
  inspectBtn.classList.toggle('on', inspecting);
  inspectBtn.textContent = inspecting ? 'Inspecting…' : 'Inspect';
  await callEngine({ ns: 'pd', cmd: 'setInspect', on: inspecting });
});

refreshBtn.addEventListener('click', () => {
  resetInspectButton();
  loadState(0);
});

chrome.devtools.network.onNavigated.addListener(() => {
  resetInspectButton();
  loadState(0);
});

// ---- focus-hint shortcut --------------------------------------------------
// Ctrl+Shift+P: re-fetch the tree (like a refresh click) and pulse the panel
// so the user sees it react.
watchFocusFlag('pd', () => {
  loadState(0);
  document.body.classList.add('focus-flash');
  setTimeout(() => document.body.classList.remove('focus-flash'), 900);
});

loadState(0);
