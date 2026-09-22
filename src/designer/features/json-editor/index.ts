// JSON editor: a JSON button next to the Inputs heading of an AD method,
// opening an editor for all of the method's test inputs at once.
import { pageObserver } from '../../core/observer';
import { createJSONButton, injectJSONButton } from './injector';
import { jsonEditorModal } from './modal';
import { TIMINGS } from '../../../config/timings';
import type { Feature } from '../../core/feature';

export class JsonEditor implements Feature {
  private button: HTMLButtonElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private firstTry: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    this.button ??= createJSONButton(() => jsonEditorModal.open());
    const button = this.button;
    // The Inputs heading renders late, and the AD app re-renders it; the
    // observer puts the button back whenever it goes missing.
    this.firstTry ??= setTimeout(() => injectJSONButton(button), TIMINGS.jsonButtonFirstTry);
    this.unsubscribe ??= pageObserver.subscribe(() => injectJSONButton(button));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.firstTry) clearTimeout(this.firstTry);
    this.firstTry = null;
    jsonEditorModal.dispose();
    this.button?.remove();
  }
}
