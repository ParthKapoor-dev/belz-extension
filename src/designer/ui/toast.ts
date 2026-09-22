import { state } from '../core/state';
import { T, FONT_MONO, RADIUS, SHADOW } from './theme';

// Toast notification component
export function ensureToast(): HTMLDivElement {
  if (state.toastEl) return state.toastEl;

  const toast = document.createElement('div');
  toast.textContent = 'Run Test triggered';

  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '999999',
    padding: '8px 12px',
    background: T.surface,
    color: T.fg,
    border: `1px solid ${T.line2}`,
    fontFamily: FONT_MONO,
    fontSize: '12px',
    borderRadius: RADIUS,
    boxShadow: SHADOW,
    opacity: '0',
    transform: 'translateY(8px)',
    transition: 'opacity 150ms ease, transform 150ms ease',
    pointerEvents: 'none'
  });

  document.body.appendChild(toast);
  state.toastEl = toast;
  return toast;
}

export function showToast(message = 'Run Test triggered'): void {
  const el = ensureToast();
  el.textContent = message;

  if (state.toastTimeout) {
    clearTimeout(state.toastTimeout);
  }

  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';

  state.toastTimeout = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
  }, 1200);
}
