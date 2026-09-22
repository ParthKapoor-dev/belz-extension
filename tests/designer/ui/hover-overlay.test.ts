import { afterEach, describe, expect, test } from 'bun:test';
import { HoverOverlay } from '../../../src/designer/ui/hover-overlay';

// Overlay targets are DOM elements: compare identities with `===` inside
// expect(), never the elements themselves (see tests/memory-guard-worker.ts).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function visibleBox(el: Element) {
  (el as any).getBoundingClientRect = () =>
    ({ top: 100, left: 100, right: 400, bottom: 220, width: 300, height: 120 }) as DOMRect;
}

function hover(el: Element) {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 150, clientY: 150 }));
}

let overlay: HoverOverlay<HTMLElement> | null = null;
afterEach(() => overlay?.stop());

function make(onClick: (t: Element) => void = () => {}) {
  overlay = new HoverOverlay<HTMLElement>({
    id: 'testOverlay',
    label: 'test overlay',
    resolveTarget: (node: Element) => (node.tagName === 'TEXTAREA' ? (node as HTMLElement) : null),
    buttons: [{ className: 'go', glyph: '>', title: 'Go', style: {}, onClick }]
  });
  return overlay;
}

describe('hover overlay', () => {
  test('appears over a matching element and hides when leaving it', async () => {
    document.body.innerHTML = '<textarea id="t"></textarea><p id="p">text</p>';
    const t = document.getElementById('t')!;
    visibleBox(t);
    make().start();

    hover(t);
    const controls = document.getElementById('testOverlay')!;
    expect(controls !== null).toBe(true);
    expect(controls.style.display).toBe('flex');
    expect(overlay!.active === t).toBe(true);

    hover(document.getElementById('p')!);
    await sleep(200); // past the hide grace period
    expect(controls.style.display).toBe('none');
  });

  test('injects one controls element for the whole page', () => {
    document.body.innerHTML = '<textarea></textarea><textarea></textarea><textarea></textarea>';
    make().start();
    for (const t of document.querySelectorAll('textarea')) {
      visibleBox(t);
      hover(t);
    }
    expect(document.querySelectorAll('#testOverlay')).toHaveLength(1);
  });

  test('a button click acts on the current target', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const t = document.getElementById('t')!;
    visibleBox(t);
    let clicked: Element | null = null;
    make((target) => { clicked = target; }).start();
    hover(t);
    (document.querySelector('#testOverlay .go') as HTMLElement).click();
    expect(clicked === t).toBe(true);
  });

  test('never decorates the extension\'s own UI', () => {
    document.body.innerHTML = '<div data-sd-extension-owned="true"><textarea id="t"></textarea></div>';
    const t = document.getElementById('t')!;
    visibleBox(t);
    make().start();
    hover(t);
    expect(overlay!.active === null).toBe(true);
  });

  test('stop removes the controls and listeners', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const t = document.getElementById('t')!;
    visibleBox(t);
    make().start();
    hover(t);
    overlay!.stop();
    expect(document.getElementById('testOverlay')).toBeNull();
    hover(t);
    expect(document.getElementById('testOverlay')).toBeNull();
  });
});
