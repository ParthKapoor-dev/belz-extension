// DOM helpers for the extension's own pages (options page, DevTools panels).

/**
 * An element the page's own HTML must contain. Throws if it is missing,
 * because that is a bug in the page, not a condition to handle.
 */
export function required<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`page markup is missing ${selector}`);
  return el;
}
