// Title updater: names the browser tab after the open method or page, as
// "AD: <method>" or "PD: <page>", so many open tabs can be told apart.
// stop() puts the page's own title back.
import { extractMethodName, extractPageName } from '../../utils/dom';
import { pageObserver } from '../../core/observer';
import { AD_ROUTE_PREFIX, PD_ROUTE_PREFIX } from '../../../config/routes';
import type { Feature } from '../../core/feature';

export class TitleUpdater implements Feature {
  /** The last name written, so the title is only written when it changes. */
  private lastName: string | null = null;
  /** The last title written. */
  private written: string | null = null;
  /** The page's own title, from before the first write; restored by stop(). */
  private original: string | null = null;
  private unsubscribe: (() => void) | null = null;

  start(): void {
    this.unsubscribe ??= pageObserver.subscribe(() => this.update());
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    // Only if the title is still ours: a title the app set since is its own.
    if (this.written !== null && document.title === this.written && this.original !== null) {
      document.title = this.original;
    }
    this.lastName = null;
    this.written = null;
    this.original = null;
  }

  update(): void {
    const pathname = window.location.pathname;
    let name: string | null = null;
    let prefix = '';

    if (pathname.startsWith(AD_ROUTE_PREFIX)) {
      name = extractMethodName();
      prefix = 'AD';
    } else if (pathname.startsWith(PD_ROUTE_PREFIX)) {
      name = extractPageName();
      prefix = 'PD';
    }

    if (!name || name === this.lastName) return;
    this.lastName = name;
    // The page's title when we first change it; not one we wrote ourselves.
    if (this.original === null || document.title !== this.written) this.original = document.title;
    this.written = `${prefix}: ${name}`;
    document.title = this.written;
  }
}
