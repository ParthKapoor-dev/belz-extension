// The IDE footer's status line, with one owner for what it shows.
//
// Three things want the line: the open's own text (the variable scope, or a
// default), a short message after a Format, and the discard prompt after Esc
// or a click outside with unsaved changes. The prompt wins while it is armed,
// then a message still within its time, then the open's own text. Each of
// the first two expires on its own timer, and the line then shows whatever
// is next: a Format message never replaces an armed prompt (it waits under
// it), and the prompt's window closing puts the line back by itself.

/** Shown after Esc or a click outside with unsaved changes; either again within the window discards them. */
export const DISCARD_PROMPT = 'Unsaved changes: press Esc or click outside again to discard them, or Ctrl+S to save.';

export interface FooterTimes {
  /** How long a second Esc or click outside discards, after the first asked. */
  discardMs: number;
  /** How long a Format message stays. */
  messageMs: number;
}

export const FOOTER_TIMES: FooterTimes = { discardMs: 3000, messageMs: 4000 };

export class FooterStatus {
  private base = '';
  private message: { text: string; warning: boolean } | null = null;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set while the discard prompt is armed: the prompt's window. */
  private discardTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    /** Puts a text on the line; `warning` colours it. */
    private readonly show: (text: string, warning: boolean) => void,
    private readonly times: FooterTimes = FOOTER_TIMES
  ) {}

  /** A new open: the line shows `base`, and nothing else is pending. */
  reset(base: string): void {
    this.clear();
    this.base = base;
    this.render();
  }

  /** Drop the message and the prompt, and their timers. */
  clear(): void {
    if (this.messageTimer) clearTimeout(this.messageTimer);
    if (this.discardTimer) clearTimeout(this.discardTimer);
    this.messageTimer = this.discardTimer = null;
    this.message = null;
  }

  /** True while a second Esc or click outside discards. */
  get discardArmed(): boolean {
    return this.discardTimer !== null;
  }

  /** Show the discard prompt, for `times.discardMs`. */
  armDiscard(): void {
    if (this.discardTimer) clearTimeout(this.discardTimer);
    this.discardTimer = setTimeout(() => {
      this.discardTimer = null;
      this.render();
    }, this.times.discardMs);
    this.render();
  }

  /** Take the discard prompt back (an edit after it). */
  disarmDiscard(): void {
    if (!this.discardTimer) return;
    clearTimeout(this.discardTimer);
    this.discardTimer = null;
    this.render();
  }

  /** A short message, for `times.messageMs`; under an armed prompt it waits its turn. */
  showMessage(text: string, warning: boolean): void {
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.message = { text, warning };
    this.messageTimer = setTimeout(() => {
      this.messageTimer = null;
      this.message = null;
      this.render();
    }, this.times.messageMs);
    this.render();
  }

  private render(): void {
    if (this.discardTimer) this.show(DISCARD_PROMPT, true);
    else if (this.message) this.show(this.message.text, this.message.warning);
    else this.show(this.base, false);
  }
}
