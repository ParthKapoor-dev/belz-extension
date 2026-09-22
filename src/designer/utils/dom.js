import { METHOD_INPUT_SELECTOR, SERVICE_CATEGORY_SELECTOR } from '../../config/constants.js';

// DOM helper utilities
export function extractMethodName() {
  const input = document.querySelector(METHOD_INPUT_SELECTOR);
  if (!input || !input.value) return null;
  return input.value.trim();
}

export function extractPageName() {
  const pageTitleDiv = document.querySelector('div.page_title') || document.querySelector('div.symbol_title');
  if (!pageTitleDiv) return null;
  return (pageTitleDiv.innerText || pageTitleDiv.innerHTML).trim();
}

export function extractServiceCategory() {
  const el = document.querySelector(SERVICE_CATEGORY_SELECTOR);
  if (!el) return null;
  return (el.innerText || el.textContent || '').trim() || null;
}
