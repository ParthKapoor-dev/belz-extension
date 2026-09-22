// Title updater: names the browser tab after the open method or page, as
// "AD: <method>" or "PD: <page>", so many open tabs can be told apart.
import { extractMethodName, extractPageName } from '../../utils/dom';
import { pageObserver } from '../../core/observer';
import { AD_ROUTE_PREFIX, PD_ROUTE_PREFIX } from '../../../config/routes';
import type { Feature } from '../../core/feature';

export class TitleUpdater implements Feature {
  /** The last name written, so the title is only written when it changes. */
  private lastName: string | null = null;
  private unsubscribe: (() => void) | null = null;

  start(): void {
    this.unsubscribe ??= pageObserver.subscribe(() => this.update());
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
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
    document.title = `${prefix}: ${name}`;
  }
}
