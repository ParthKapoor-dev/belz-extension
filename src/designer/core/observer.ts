/*! belz-singleton: designer/core/observer */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
//
// One MutationObserver for the whole page, shared by every feature that needs
// to react to DOM changes. It runs only while someone is subscribed.
import { createLogger } from '../../shared/logger';

const log = createLogger('observer');

// The MutationObserver only watches document.body, so changes inside a shadow
// root never reach it. The poll is the safety net for those — but it used to
// run every subscriber unconditionally once a second, which on a large method
// meant re-scanning the whole page forever, even while the user did nothing.
//
// It now checks a cheap fingerprint first and skips the work when the DOM has
// not actually changed, on a longer interval since it is only a fallback.
const POLL_FALLBACK_MS = 2000;

type Subscriber = () => void;

// Reading the length of the live "all elements" collection is far cheaper than
// querySelectorAll('*'), which materialises an array of every node. It misses
// same-size swaps, which is acceptable for a fallback: the MutationObserver
// already covers the light DOM, and a shadow-root edit that leaves the element
// count identical is picked up by the next structural change.
function domFingerprint(): number {
  try {
    return document.getElementsByTagName('*').length;
  } catch {
    return -1;
  }
}

export class PageObserver {
  private readonly subscribers = new Set<Subscriber>();
  private observer: MutationObserver | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastFingerprint = -1;

  /**
   * Calls `callback` now, then after every DOM change. Returns the function
   * that unsubscribes it.
   */
  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    this.start();
    try {
      callback();
    } catch (error) {
      log.error('Observer subscriber failed on initial call:', error);
    }
    return () => this.unsubscribe(callback);
  }

  unsubscribe(callback: Subscriber): void {
    this.subscribers.delete(callback);
    if (this.subscribers.size === 0) this.stop();
  }

  private start(): void {
    if (!this.observer) {
      // Keep the fingerprint current so the poll does not redo work the
      // observer has already triggered.
      this.observer = new MutationObserver(() => {
        this.lastFingerprint = domFingerprint();
        this.fireAll();
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    }
    if (!this.pollTimer) {
      this.lastFingerprint = domFingerprint();
      this.pollTimer = setInterval(() => this.pollTick(), POLL_FALLBACK_MS);
    }
  }

  private stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private pollTick(): void {
    const fingerprint = domFingerprint();
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    this.fireAll();
  }

  private fireAll(): void {
    for (const callback of this.subscribers) {
      try {
        callback();
      } catch (error) {
        log.error('Observer subscriber failed:', error);
      }
    }
  }
}

/** The observer of this page's DOM. */
export const pageObserver = new PageObserver();
