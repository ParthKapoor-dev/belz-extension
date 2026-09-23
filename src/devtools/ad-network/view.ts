// Small DOM builders for the AD Network panel. `el` itself is shared by both
// panels, in ../view.ts.

import { el } from '../view';

/** How long a button shows its "done" state. */
const FLASH_MS = 700;

export const ICON_COPY =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/>' +
  '<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
export const ICON_OPEN =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M11 13 20 4"/>' +
  '<path d="M19 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></svg>';
export const ICON_LINK =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
  '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

/** A row action button. `svg` is one of the constant icons above. */
export function iconButton(svg: string, title: string, handler: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'act';
  b.type = 'button';
  b.title = title;
  b.innerHTML = svg;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    handler(b);
  });
  return b;
}

/** Show a button's "done" state briefly. */
export function flashOk(btn: HTMLElement): void {
  btn.classList.add('ok');
  setTimeout(() => btn.classList.remove('ok'), FLASH_MS);
}

/** Replace an element's text for a moment, then restore it. */
export function flashText(target: HTMLElement, text: string): void {
  const prev = target.textContent;
  target.textContent = text;
  setTimeout(() => {
    target.textContent = prev;
  }, FLASH_MS);
}

/** A two-column key/value grid; empty values show as a dash. */
export function kvGrid(pairs: Array<[string, unknown]>): HTMLElement {
  const grid = el('div', { className: 'kv' });
  for (const [k, v] of pairs) {
    grid.append(
      el('div', { className: 'k' }, k),
      el('div', { className: 'v' }, v == null || v === '' ? '—' : String(v))
    );
  }
  return grid;
}
