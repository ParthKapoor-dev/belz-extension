/*! belz-singleton: designer/ui/toast */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
//
// A short message in the bottom-right corner. One element, reused.
import { T, FONT_MONO, RADIUS, SHADOW } from './theme';
import { EXTENSION_OWNED_ATTR } from '../../config/namespace';

const VISIBLE_MS = 1200;

export class Toast {
  private el: HTMLDivElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  show(message: string): void {
    const el = this.element();
    el.textContent = message;
    if (this.hideTimer) clearTimeout(this.hideTimer);

    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    this.hideTimer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
    }, VISIBLE_MS);
  }

  private element(): HTMLDivElement {
    // The host app can wipe and re-render the body, taking the toast with it:
    // rebuild rather than write into a detached element.
    if (this.el && this.el.isConnected) return this.el;
    const el = document.createElement('div');
    el.setAttribute(EXTENSION_OWNED_ATTR, 'true');
    Object.assign(el.style, {
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
    document.body.appendChild(el);
    this.el = el;
    return el;
  }
}

/** The page's toast. */
export const toast = new Toast();
