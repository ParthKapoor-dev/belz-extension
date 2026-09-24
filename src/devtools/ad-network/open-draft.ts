// "Open in draft": open a method's draft designer page in a background tab,
// its test inputs filled with the captured request's body.
//
// Clicks are queued and handled one at a time, a short gap apart, so a burst
// of clicks opens its tabs in order. The panel supplies what one open does
// (look the method up, build the URL, open it); this module owns the queue,
// the handoff URL and the tab.

import { AUTOFILL_FRAGMENT_PARAM } from '../../config/namespace';
import { storeHandoff } from '../../shared/autofill-handoff';
import { createLogger } from '../../shared/logger';
import type { HarEntry, Row } from './types';

const log = createLogger('ad-network');

/** Pause between two queued tabs. */
const OPEN_GAP_MS = 150;

/**
 * Opens queued rows one after another, OPEN_GAP_MS apart. `open(row,
 * isCurrent)` handles one row and never rejects; `isCurrent()` turns false
 * once stop() has run, and `open` then does nothing more.
 */
export class OpenQueue {
  private readonly rows: Row[] = [];
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by stop(), so an open still running does nothing after it. */
  private generation = 0;

  constructor(private readonly open: (row: Row, isCurrent: () => boolean) => Promise<void>) {}

  /** Rows waiting, not counting the one being opened. */
  get size(): number {
    return this.rows.length;
  }

  add(row: Row): void {
    this.rows.push(row);
    void this.next();
  }

  /** Drop everything queued and the pending gap timer. The queue can be used again. */
  stop(): void {
    this.generation++;
    this.rows.length = 0;
    this.busy = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async next(): Promise<void> {
    if (this.busy || this.timer) return;
    const row = this.rows.shift();
    if (!row) return;
    const generation = this.generation;
    const isCurrent = (): boolean => generation === this.generation;
    this.busy = true;
    try {
      await this.open(row, isCurrent);
    } catch (err) {
      log.warn('opening in draft failed:', err);
    }
    if (!isCurrent()) return;
    this.busy = false;
    if (this.rows.length) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.next();
      }, OPEN_GAP_MS);
    }
  }
}

/**
 * A designer URL that autofills the method's inputs with this request's body.
 * The body is left in extension storage under a one-time id, and only the id
 * goes in the URL's fragment (see shared/autofill-handoff.ts).
 */
export async function withAutofill(url: string, har: HarEntry): Promise<string> {
  const body = har.request?.postData?.text || '';
  if (!body) return url;
  try {
    const id = await storeHandoff(body);
    return `${url.split('#')[0]}#${AUTOFILL_FRAGMENT_PARAM}=${id}`;
  } catch (err) {
    log.warn('cannot hand the request body over; opening without autofill:', err);
    return url;
  }
}

/**
 * Open `url` in a background tab: chrome.tabs where the DevTools page has it
 * (Chromium), window.open otherwise (Firefox gives DevTools pages no
 * chrome.tabs) or when creating the tab failed.
 */
export async function openInBackgroundTab(url: string): Promise<void> {
  if (chrome.tabs?.create) {
    try {
      await chrome.tabs.create({ url, active: false });
      return;
    } catch (err) {
      log.debug('chrome.tabs.create failed, using window.open:', err);
    }
  }
  try {
    window.open(url, '_blank');
  } catch (err) {
    log.warn('cannot open a tab:', err);
  }
}
