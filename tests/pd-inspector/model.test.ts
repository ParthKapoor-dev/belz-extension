import { describe, expect, test } from 'bun:test';
import { buildTree, getVisibility, KIND, summarize } from '../../src/pd-inspector/tree';
import { collectChildRefs, isSymbolRef } from '../../src/pd-inspector/config';
import { buildComponentTree, componentNames } from '../../src/pd-inspector/component-tree';

const symbol = (name: string) => ({ name, isSymbol: true });
const layout = (...children: any[]) => ({ name: 'exp-layout', children });

describe('config tree', () => {
  test('kinds and labels', () => {
    const root = buildTree(layout(
      { name: 'exp-field', field: { label: 'VIN', name: 'vin' } },
      { name: 'exp-button', props: { innerHTML: '<b>Save</b> now' } },
      { name: 'exp-data-table' },
      symbol('header'),
      { name: 'div', props: { className: 'card wide' } }
    ))!;
    expect(root.kind).toBe(KIND.LAYOUT);
    expect(root.children.map((c: any) => [c.kind, c.label])).toEqual([
      [KIND.FORM_FIELD, 'VIN'],
      [KIND.BUTTON, 'Save now'],
      [KIND.DATA_TABLE, 'exp-data-table'],
      [KIND.SYMBOL, 'header'],
      [KIND.GENERIC, 'div .card']
    ]);
    expect(root.children[0].fieldName).toBe('vin');
  });

  test('visibility verdicts', () => {
    expect(getVisibility({})).toEqual({ kind: 'always' });
    expect(getVisibility({ props: { isVisible: 'false' } })).toEqual({ kind: 'static-hidden' });
    expect(getVisibility({ props: { isVisible: true } })).toEqual({ kind: 'static-visible' });
    expect(getVisibility({ props: { '[isVisible]': 'a == 1' } })).toEqual({ kind: 'bound', expr: 'a == 1' });
  });

  test('summary counts', () => {
    const root = buildTree(layout(
      { name: 'a', props: { '[isVisible]': 'x' } },
      { name: 'b', props: { isVisible: false } },
      { name: 'c' }
    ));
    expect(summarize(root)).toEqual({ total: 4, bound: 1, hidden: 1 });
  });

  test('missing ids get stable synthetic ones', () => {
    const root = buildTree(layout({ name: 'a' }, { name: 'b', id: 'real' }))!;
    expect(root.children.map((c: any) => c.id)).toEqual(['__synthetic_1', 'real']);
  });
});

describe('references', () => {
  test('a symbol reference is a childless isSymbol node', () => {
    expect(isSymbolRef(symbol('x'))).toBe(true);
    // A component definition root also carries isSymbol, but has content.
    expect(isSymbolRef({ name: 'x', isSymbol: true, children: [{ name: 'div' }] })).toBe(false);
    expect(isSymbolRef({ isSymbol: true })).toBe(false);
  });

  test('refs in document order, outlet included, not descending into refs', () => {
    const refs = collectChildRefs(layout(
      symbol('nav'),
      layout({ name: 'router-outlet' }, symbol('footer'))
    ));
    expect(refs).toEqual([
      { type: 'symbol', name: 'nav' },
      { type: 'outlet' },
      { type: 'symbol', name: 'footer' }
    ]);
  });
});

describe('buildComponentTree', () => {
  const graph = new Map<string, any>([
    ['nav', { name: 'nav', referencePageId: 'p-nav', layout: layout(symbol('logo')) }],
    ['logo', { name: 'logo', referencePageId: '', layout: layout({ name: 'img' }) }],
    ['loop', { name: 'loop', referencePageId: '', layout: layout(symbol('loop')) }],
    ['bad', { name: 'bad', referencePageId: '', layout: null, error: 'HTTP 500' }]
  ]);
  const page = { path: 'app/home', referencePageId: 'pg', layout: layout(symbol('nav'), symbol('bad'), symbol('ghost')) };

  const shape = (n: any): any => [n.kind, n.name, n.error ?? undefined, n.children.map(shape)].filter((x) => x !== undefined);

  test('nests components under the page', () => {
    const tree = buildComponentTree(page, graph, null);
    expect(shape(tree)).toEqual(['page', 'app/home', [
      ['component', 'nav', [['component', 'logo', []]]],
      ['component', 'bad', 'HTTP 500', []],
      ['component', 'ghost', 'component not fetched', []]
    ]]);
    expect(componentNames(tree).sort()).toEqual(['bad', 'ghost', 'logo', 'nav']);
  });

  test('a shell wraps the page at its outlet', () => {
    const shell = { path: 'app', referencePageId: 'sh', layout: layout(symbol('nav'), { name: 'router-outlet' }) };
    const tree = buildComponentTree(page, graph, shell);
    expect(tree.kind).toBe('shell');
    expect(tree.children.map((c: any) => [c.kind, c.name])).toEqual([
      ['component', 'nav'],
      ['page', 'app/home']
    ]);
  });

  test('a component that embeds itself does not recurse forever', () => {
    const selfPage = { path: 'p', referencePageId: '', layout: layout(symbol('loop')) };
    const tree = buildComponentTree(selfPage, graph, null);
    const loop = tree.children[0];
    expect(loop.children).toHaveLength(1);
    expect(loop.children[0].children).toEqual([]);
  });
});
