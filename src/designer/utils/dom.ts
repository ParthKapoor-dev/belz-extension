import { METHOD_INPUT_SELECTOR, SERVICE_CATEGORY_SELECTOR } from '../../config/constants';

// DOM helper utilities
export function extractMethodName(): string | null {
  const input = document.querySelector<HTMLInputElement>(METHOD_INPUT_SELECTOR);
  if (!input || !input.value) return null;
  return input.value.trim();
}

export function extractPageName(): string | null {
  const pageTitleDiv =
    document.querySelector<HTMLElement>('div.page_title') ||
    document.querySelector<HTMLElement>('div.symbol_title');
  if (!pageTitleDiv) return null;
  return (pageTitleDiv.innerText || pageTitleDiv.innerHTML).trim();
}

export function extractServiceCategory(): string | null {
  const el = document.querySelector<HTMLElement>(SERVICE_CATEGORY_SELECTOR);
  if (!el) return null;
  return (el.innerText || el.textContent || '').trim() || null;
}
