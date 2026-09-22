// The PD Inspector's data model, shared by the page-side engine
// (src/pd-inspector) and the DevTools panel (src/devtools/pd-inspector).

// ---- the wire format: compiled Page Designer configs --------------------------

/** One node of a compiled config's `layout`, as the deployable endpoint serves it. */
export interface RawLayoutNode {
  id?: string;
  _elementId?: string;
  /** Element or component name, e.g. "exp-layout", or a symbol's name. */
  name?: string;
  props?: Record<string, unknown>;
  children?: RawLayoutNode[];
  /** Set on a form field node. */
  field?: { label?: string; name?: string };
  /** Set on a component (symbol) reference, and on a component's root. */
  isSymbol?: boolean;
}

/** Where the inspected published page is. */
export interface PageContext {
  host: string;
  /** The app path after /pages/. */
  path: string;
  /** Environment slug from the host, e.g. "nsm-dev". */
  env: string;
}

/** Compiled config for one published page (or an app shell). */
export interface PageConfig {
  path: string;
  referencePageId: string;
  pageVersionId: number;
  layout: RawLayoutNode | null;
}

/** Compiled config for one PD component. `error` is set on a stub for a failed fetch. */
export interface ComponentConfig {
  name: string;
  referencePageId: string;
  layout: RawLayoutNode | null;
  error?: string;
}

/** Every component a page embeds, by name. */
export type ComponentGraph = Map<string, ComponentConfig>;

// ---- the normalised config tree --------------------------------------------------

export type NodeKind = 'FORM_FIELD' | 'DATA_TABLE' | 'BUTTON' | 'SYMBOL' | 'LAYOUT' | 'GENERIC';

/**
 * Whether a node renders:
 *  - always         — no visibility prop; renders unconditionally
 *  - static-visible — `isVisible` literal truthy
 *  - static-hidden  — `isVisible` literal false
 *  - bound          — `[isVisible]` expression; decided at runtime
 */
export type Visibility =
  | { kind: 'always' }
  | { kind: 'static-visible' }
  | { kind: 'static-hidden' }
  | { kind: 'bound'; expr: string };

/** A config node, normalised for display. */
export interface TreeNode {
  id: string;
  name: string;
  kind: NodeKind;
  label: string;
  fieldName: string;
  visibility: Visibility;
  depth: number;
  raw: RawLayoutNode;
  children: TreeNode[];
}

/** A TreeNode without its raw config, as sent to the panel. */
export type SerializedTreeNode = Omit<TreeNode, 'raw' | 'children'> & {
  children: SerializedTreeNode[];
};

export interface NodeSummary {
  total: number;
  bound: number;
  hidden: number;
}

// ---- the component-nesting tree -------------------------------------------------

export type ComponentKind = 'shell' | 'page' | 'component';

/** A node of the component-nesting tree. */
export interface ComponentTreeNode {
  name: string;
  kind: ComponentKind;
  /** True for a page or shell; a shell is a page. */
  isPage: boolean;
  referencePageId: string;
  nodeTree: TreeNode | null;
  nodeSummary: NodeSummary;
  children: ComponentTreeNode[];
  error: string | null;
}

/** A ComponentTreeNode as sent to the panel: no raw configs. */
export type SerializedComponentNode = Omit<ComponentTreeNode, 'nodeTree' | 'children'> & {
  nodeTree: SerializedTreeNode | null;
  children: SerializedComponentNode[];
};

// ---- DOM ownership --------------------------------------------------------------

/** A config node flattened with the component chain that produced it. */
export interface IndexedNode {
  name: string;
  /** Owning components, outermost first. */
  chain: string[];
  /** The innermost owner: the last entry of `chain`. */
  owner: string;
  className: string;
}

export interface ConfigIndex {
  nodes: IndexedNode[];
  byClass: Map<string, IndexedNode[]>;
}

export interface AnchorStats {
  anchored: number;
  exact: number;
  positional: number;
  unresolved: number;
}

// ---- engine state, as the panel receives it ------------------------------------

export interface PageInfo {
  host: string;
  path: string;
  env: string;
  referencePageId: string;
  pageVersionId: number;
  shellPath: string;
  shellReferencePageId: string;
  componentCount: number;
  configNodes: number;
  anchors: AnchorStats;
}

export type EngineState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; pageInfo: PageInfo; componentTree: SerializedComponentNode };
