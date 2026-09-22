import { AD, PD } from '../../config/selectors';

/** The first element under `root` matching one of `selectors`, tried in order. */
export function firstMatch<T extends Element = HTMLElement>(
  root: ParentNode,
  selectors: readonly string[]
): T | null {
  for (const selector of selectors) {
    const el = root.querySelector<T>(selector);
    if (el) return el;
  }
  return null;
}

export function extractMethodName(): string | null {
  const input = document.querySelector<HTMLInputElement>(AD.methodNameInput);
  if (!input || !input.value) return null;
  return input.value.trim();
}

export function extractPageName(): string | null {
  const pageTitleDiv = firstMatch(document, PD.pageTitle);
  if (!pageTitleDiv) return null;
  return (pageTitleDiv.innerText || pageTitleDiv.innerHTML).trim();
}

export function extractServiceCategory(): string | null {
  const el = document.querySelector<HTMLElement>(AD.serviceCategory);
  if (!el) return null;
  return (el.innerText || el.textContent || '').trim() || null;
}
