// JSON editor: a JSON button next to the Inputs heading of an AD method,
// opening an editor for all of the method's test inputs at once.
import { pageObserver } from '../../core/observer';
import { createJSONButton, injectJSONButton, restoreHeadings, type StyledHeadings } from './injector';
import { jsonEditorModal } from './modal';
import { TIMINGS } from '../../../config/timings';
import type { Feature } from '../../core/feature';

export class JsonEditor implements Feature {
  private button: HTMLButtonElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private firstTry: ReturnType<typeof setTimeout> | null = null;
  /** The look deferred by the throttle, if one is waiting. */
  private trailing: ReturnType<typeof setTimeout> | null = null;
  /** When the page was last searched for the Inputs heading (epoch ms). */
  private lastSearch = 0;
  /** Inputs headings restyled to hold the button; put back by stop(). */
  private readonly styled: StyledHeadings = new Map();

  start(): void {
    this.button ??= createJSONButton(() => jsonEditorModal.open());
    // The Inputs heading renders late, and the AD app re-renders it; the
    // observer puts the button back whenever it goes missing.
    this.firstTry ??= setTimeout(this.inject, TIMINGS.jsonButtonFirstTry);
    this.unsubscribe ??= pageObserver.subscribe(this.onPageChange);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.firstTry) clearTimeout(this.firstTry);
    if (this.trailing) clearTimeout(this.trailing);
    this.firstTry = null;
    this.trailing = null;
    jsonEditorModal.dispose();
    this.button?.remove();
    restoreHeadings(this.styled);
  }

  /**
   * The page changed. Searching for the heading walks the page's text, and a
   * busy page changes constantly (a method without an Inputs step never
   * stops looking), so it runs at most once per TIMINGS.jsonButtonThrottle,
   * with one deferred look after a burst.
   */
  private readonly onPageChange = (): void => {
    if (this.button?.isConnected) return;
    const wait = this.lastSearch + TIMINGS.jsonButtonThrottle - Date.now();
    if (wait <= 0) {
      this.inject();
      return;
    }
    this.trailing ??= setTimeout(() => {
      this.trailing = null;
      this.onPageChange();
    }, wait);
  };

  private readonly inject = (): void => {
    if (!this.button) return;
    this.lastSearch = Date.now();
    injectJSONButton(this.button, this.styled);
  };
}
