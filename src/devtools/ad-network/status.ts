// The AD Network panel's two status surfaces: the toast (what a row action
// just did) and the offline pill (why names are missing).

/** How long a toast stays up. */
const TOAST_MS = 3000;

export class PanelStatus {
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly toastEl: HTMLElement,
    private readonly offlineEl: HTMLElement
  ) {}

  /** Show `text` in the toast for TOAST_MS; a newer toast replaces it. */
  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      this.toastEl.classList.add('hidden');
    }, TOAST_MS);
  }

  /**
   * Show or hide the offline pill. It is the only place a lookup failure is
   * visible, so it carries the actual reason rather than a generic
   * "unavailable"; hover for the full message.
   */
  setOffline(off: boolean, reason = ''): void {
    const pill = this.offlineEl;
    pill.classList.toggle('hidden', !off);
    if (!off) {
      pill.title = '';
      return;
    }
    pill.textContent = reason
      ? `names unavailable — ${reason}`
      : 'names unavailable — sign in to this site and retry';
    pill.title = reason
      ? `${reason}\n\nOpen the panel's own console (right-click → Inspect on this ` +
        `panel) for the full error.`
      : '';
  }

  /** Cancel the toast timer; the toast stays as it is. */
  stop(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
  }
}
