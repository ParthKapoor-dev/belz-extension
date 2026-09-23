// Config-tree model.
//
// Turns a raw compiled-config `layout` node (the wire `RawLayoutNode` shape:
// id, name, props, children, field, isSymbol, _elementId) into a normalized
// tree the DevTools panel can render — with a node kind, a human label, and the
// visibility verdict that drives the "conditionally hidden" workflow.

import { PD_CONFIG_NODES } from '../config/selectors';
import type { NodeKind, NodeSummary, RawLayoutNode, TreeNode, Visibility } from './types';

export const KIND: { readonly [K in NodeKind]: K } = {
  FORM_FIELD: 'FORM_FIELD',
  DATA_TABLE: 'DATA_TABLE',
  BUTTON: 'BUTTON',
  SYMBOL: 'SYMBOL',
  LAYOUT: 'LAYOUT',
  GENERIC: 'GENERIC'
};

/** Short badge text per kind, shown in the tree. */
export const KIND_BADGE: Record<NodeKind, string> = {
  FORM_FIELD: 'FIELD',
  DATA_TABLE: 'TABLE',
  BUTTON: 'BTN',
  SYMBOL: 'SYM',
  LAYOUT: 'LAYOUT',
  GENERIC: '-'
};

function detectKind(raw: RawLayoutNode): NodeKind {
  const name = String(raw.name || '').toLowerCase();
  if (raw.field || (PD_CONFIG_NODES.formFields as readonly string[]).includes(name)) {
    return KIND.FORM_FIELD;
  }
  if (name.includes(PD_CONFIG_NODES.dataTablePart)) return KIND.DATA_TABLE;
  if ((PD_CONFIG_NODES.buttons as readonly string[]).includes(name)) return KIND.BUTTON;
  // A symbol *reference* (childless `isSymbol` leaf) is an embedded component;
  // a definition root also carries `isSymbol` but has children — that is layout.
  if (raw.isSymbol && !(raw.children && raw.children.length)) return KIND.SYMBOL;
  if (Array.isArray(raw.children) && raw.children.length) return KIND.LAYOUT;
  return KIND.GENERIC;
}

/** First plain-text run of an HTML string, trimmed and clipped. */
function textOf(html: unknown): string {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function deriveLabel(raw: RawLayoutNode, kind: NodeKind): string {
  const props = raw.props || {};
  if (kind === KIND.FORM_FIELD && raw.field) {
    return raw.field.label || raw.field.name || raw.name || 'field';
  }
  if (kind === KIND.BUTTON) {
    return (
      (typeof props.label === 'string' ? props.label : '') ||
      textOf(props.innerHTML) ||
      textOf(props['[innerHTML]']) ||
      'button'
    );
  }
  if (kind === KIND.SYMBOL) return raw.name || 'symbol';
  const cls = typeof props.className === 'string' ? props.className.trim() : '';
  if (cls) return `${raw.name} .${cls.split(/\s+/)[0]}`;
  return raw.name || 'node';
}

/** Visibility verdict for a node (see Visibility in types.ts). */
export function getVisibility(raw: RawLayoutNode): Visibility {
  const props = raw.props || {};
  if ('[isVisible]' in props) {
    return { kind: 'bound', expr: String(props['[isVisible]']) };
  }
  if ('isVisible' in props) {
    const v = props.isVisible;
    const hidden = v === false || v === 'false';
    return { kind: hidden ? 'static-hidden' : 'static-visible' };
  }
  return { kind: 'always' };
}

/** Build the normalized tree from a raw compiled-config `layout` root. */
export function buildTree(rawRoot: RawLayoutNode | null): TreeNode | null {
  let synthetic = 0;
  const visit = (raw: RawLayoutNode, depth: number): TreeNode => {
    const kind = detectKind(raw);
    const id = raw.id || raw._elementId || `__synthetic_${synthetic++}`;
    return {
      id,
      name: raw.name || '?',
      kind,
      label: deriveLabel(raw, kind),
      fieldName: (raw.field && raw.field.name) || '',
      visibility: getVisibility(raw),
      depth,
      raw,
      children: Array.isArray(raw.children)
        ? raw.children.map((c) => visit(c, depth + 1))
        : []
    };
  };
  return rawRoot ? visit(rawRoot, 0) : null;
}

/** Count nodes, conditionally-bound nodes and statically hidden nodes. */
export function summarize(root: TreeNode | null): NodeSummary {
  let total = 0;
  let bound = 0;
  let hidden = 0;
  const walk = (n: TreeNode | null) => {
    if (!n) return;
    total++;
    if (n.visibility.kind === 'bound') bound++;
    if (n.visibility.kind === 'static-hidden') hidden++;
    n.children.forEach(walk);
  };
  walk(root);
  return { total, bound, hidden };
}
