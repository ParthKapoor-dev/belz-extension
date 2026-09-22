import { describe, expect, test } from 'bun:test';
import { buildConfigIndex, createResolver } from '../../src/pd-inspector/resolve';

// The resolver maps DOM elements to config nodes. Results hold DOM elements,
// so assertions below compare plain fields (see tests/memory-guard-worker.ts).

const node = (name: string, className?: string, children: any[] = []) =>
  ({ name, props: className ? { className } : {}, children });

describe('buildConfigIndex', () => {
  test('flattens page, components and the outlet with their owner chain', () => {
    const graph = new Map([['card', { name: 'card', referencePageId: '', layout: node('div', 'card', [node('span', 'card-title')]) }]]);
    const shell = { path: 'shell', layout: node('div', 'frame', [{ name: 'card', isSymbol: true }, node('router-outlet')]) };
    const page = { path: 'page', layout: node('main', 'content') };
    const index = buildConfigIndex(shell, graph, page);

    const owners = Object.fromEntries(index.nodes.filter((n: any) => n.className).map((n: any) => [n.className, n.chain.join('>')]));
    expect(owners).toEqual({
      frame: 'shell',
      card: 'shell>card',
      'card-title': 'shell>card',
      content: 'shell>page'
    });
  });
});

describe('createResolver', () => {
  function setup(html: string, layout: any) {
    document.body.innerHTML = html;
    const resolver = createResolver(buildConfigIndex({ path: 'page', layout }, new Map(), null));
    const who = (sel: string) => {
      const hit = resolver.resolve(document.querySelector(sel)!);
      return hit ? { owner: hit.owner, node: hit.node.className, exact: hit.exact } : null;
    };
    return { resolver, who };
  }

  test('one node, one element: exact; descendants climb to it', () => {
    const { who } = setup('<div class="card"><p><b id="x">x</b></p></div>', node('div', 'card'));
    expect(who('#x')).toEqual({ owner: 'page', node: 'card', exact: true });
  });

  test('several of each with equal counts pair up in document order', () => {
    const { who } = setup(
      '<i class="row" id="r1"></i><i class="row" id="r2"></i>',
      node('div', undefined, [node('i', 'row'), node('i', 'row')])
    );
    expect(who('#r1')).toEqual({ owner: 'page', node: 'row', exact: false });
    expect(who('#r2')?.node).toBe('row');
  });

  test('mismatched counts are refused rather than guessed', () => {
    const { resolver, who } = setup(
      '<i class="row" id="r1"></i><i class="row"></i><i class="row"></i>',
      node('div', undefined, [node('i', 'row'), node('i', 'row')])
    );
    expect(who('#r1')).toBeNull();
    resolver.rebuild();
    expect(resolver.getStats()).toMatchObject({ anchored: 0, unresolved: 2 });
  });

  test('a class token that is not a valid selector does not break the rest', () => {
    const { who } = setup('<div class="ok" id="ok"></div>', node('div', undefined, [node('p', '{{bad}} ['), node('div', 'ok')]));
    expect(who('#ok')?.node).toBe('ok');
  });

  test('elementsForComponent finds the innermost owner only', () => {
    const { resolver } = setup('<div class="a"></div>', node('div', 'a'));
    expect(resolver.elementsForComponent('page').map((e: Element) => e.className)).toEqual(['a']);
    expect(resolver.elementsForComponent('other')).toHaveLength(0);
  });
});
