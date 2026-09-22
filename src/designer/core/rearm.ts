// Re-registers a feature's page listeners while the host app boots.
//
// The designers are SPAs that finish bootstrapping after our content script
// runs (document_idle). Listeners registered before that point were observed
// never to receive events, while identical ones registered afterwards work;
// toggling the feature off and on was the only way back. Calling `attach` a
// few times over the first seconds, and on the document lifecycle events,
// covers it without depending on why. `attach` must be idempotent: remove,
// then add.

/** When to re-attach, in ms after start: spanning a slow SPA bootstrap. */
const REARM_DELAYS_MS = [1000, 3000, 6000];

export class Rearm {
  private readonly timers: Array<ReturnType<typeof setTimeout>> = [];
  private active = false;

  constructor(private readonly attach: () => void) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    for (const delay of REARM_DELAYS_MS) this.timers.push(setTimeout(this.run, delay));
    window.addEventListener('load', this.run);
    window.addEventListener('pageshow', this.run);
  }

  stop(): void {
    this.active = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.length = 0;
    window.removeEventListener('load', this.run);
    window.removeEventListener('pageshow', this.run);
  }

  private readonly run = (): void => {
    if (this.active) this.attach();
  };
}
