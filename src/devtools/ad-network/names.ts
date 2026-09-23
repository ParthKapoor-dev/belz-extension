// Method names and categories in the AD Network panel: what is known so far,
// and the queue that asks the platform for the rest.

import { isRetryableError, type MethodResolver } from './api';
import type { MethodSummary } from './types';
import { errorText } from '../../shared/errors';
import { TIMINGS } from '../../config/timings';
import { createLogger } from '../../shared/logger';

const log = createLogger('ad-network');

const RESOLVE_DEBOUNCE_MS = 250;
/** Never hammer the platform with a burst — resolve a few uuids at a time. */
const RESOLVE_CONCURRENCY = 4;

/** When to retry a failed lookup, and when to give up on it. */
export interface RetryPolicy {
  /** Wait before the first retry, in ms; each later one waits twice as long… */
  first: number;
  /** …up to this. */
  max: number;
  /** A uuid whose lookup failed this many times is not tried again. */
  attempts: number;
}

/** Names and categories learned so far; tells the panel when one changes. */
export class MethodNames {
  private readonly names = new Map<string, string>();
  private readonly categories = new Map<string, string>();

  /** `onChange(uuid)`: repaint whatever shows that uuid. */
  constructor(private readonly onChange: (uuid: string) => void) {}

  name(uuid: string): string | undefined {
    return this.names.get(uuid);
  }

  category(uuid: string): string | undefined {
    return this.categories.get(uuid);
  }

  /** True while the name or the category of `uuid` is still unknown. */
  isIncomplete(uuid: string): boolean {
    return !this.names.has(uuid) || !this.categories.has(uuid);
  }

  learnName(uuid: string, name: string): void {
    if (!uuid || !name || this.names.get(uuid) === name) return;
    this.names.set(uuid, name);
    this.onChange(uuid);
  }

  learnCategory(uuid: string, category: string): void {
    if (!uuid || !category || this.categories.get(uuid) === category) return;
    this.categories.set(uuid, category);
    this.onChange(uuid);
  }

  /** Learn whatever a summary says. */
  apply(uuid: string, summary: MethodSummary | null): void {
    if (!summary) return;
    if (summary.name) this.learnName(uuid, summary.name);
    if (summary.category) this.learnCategory(uuid, summary.category);
  }
}

/**
 * Resolves queued uuids against the platform, a few at a time, after a short
 * debounce. Cache hits return without touching the network, so a warm panel
 * paints instantly. A uuid whose resolve fails with a retryable error
 * (`isRetryableError` in api.ts: unreachable host, 401/403, 408/429/5xx, or no
 * HTTP status) goes back on the queue — the user may still be signing in, or
 * the page may not have fired an authenticated request yet for us to lift a
 * token from. Retries back off (TIMINGS.resolveRetry: the wait doubles after
 * each failing round, up to a maximum) and a uuid is given up after a fixed
 * number of failed lookups. Any other failure (a 404 on both endpoints, a page
 * that is not on an allowed site) is final for that uuid, as is a null
 * summary.
 */
export class ResolveQueue {
  private readonly pending = new Set<string>();
  /** Failed lookups so far, per uuid; a success forgets it. */
  private readonly failures = new Map<string, number>();
  /** Consecutive rounds with a failure: sets the next retry's wait. */
  private failedRounds = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by stop(), so a flush already running delivers nothing after it. */
  private generation = 0;

  /**
   * @param ready The promise that settles once the origin, site list and
   *   cache are loaded; asked for at each flush, since the panel makes a new
   *   one per start().
   * @param onOutcome Told after each batch whether names are unavailable, and why.
   * @param retry The retry schedule; TIMINGS.resolveRetry unless a test passes its own.
   */
  constructor(
    private readonly resolver: MethodResolver,
    private readonly names: MethodNames,
    private readonly ready: () => Promise<void>,
    private readonly onOutcome: (failed: boolean, reason: string) => void,
    private readonly retry: RetryPolicy = TIMINGS.resolveRetry
  ) {}

  add(uuid: string): void {
    if (!this.names.isIncomplete(uuid)) return;
    if ((this.failures.get(uuid) ?? 0) >= this.retry.attempts) return; // given up
    this.pending.add(uuid);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, RESOLVE_DEBOUNCE_MS);
  }

  /**
   * Drop everything queued, every timer and every failure count. The queue
   * can be used again.
   */
  stop(): void {
    this.generation++;
    this.pending.clear();
    this.failures.clear();
    this.failedRounds = 0;
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
  }

  /** The wait before the next retry round, after `rounds` failing rounds in a row. */
  retryDelay(rounds: number): number {
    return Math.min(this.retry.first * 2 ** Math.max(0, rounds - 1), this.retry.max);
  }

  private async flush(): Promise<void> {
    const generation = this.generation;
    await this.ready();
    if (generation !== this.generation) return;
    const uuids = [...this.pending].filter((uuid) => this.names.isIncomplete(uuid));
    this.pending.clear();
    if (uuids.length === 0) return;

    /** Failed with a retryable error and not given up: queued again. */
    const failed: string[] = [];
    let anyFailed = false;
    let lastError: unknown = null;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < uuids.length) {
        const uuid = uuids[cursor++]!;
        try {
          const summary = await this.resolver.resolveSummary(uuid, (fresh) =>
            this.names.apply(uuid, fresh)
          );
          // A null summary is a definitive miss (the uuid is not an AD method
          // on this instance) — do not retry it.
          this.failures.delete(uuid);
          this.names.apply(uuid, summary);
        } catch (err) {
          lastError = err;
          anyFailed = true;
          const count = (this.failures.get(uuid) ?? 0) + 1;
          this.failures.set(uuid, count);
          const retry = isRetryableError(err) && count < this.retry.attempts;
          log.warn(`resolve failed for ${uuid}${retry ? ' (will retry)' : ''}:`, err);
          if (retry) failed.push(uuid);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, uuids.length) }, worker));
    if (generation !== this.generation) return; // stopped meanwhile

    this.onOutcome(anyFailed, errorText(lastError));
    this.failedRounds = anyFailed ? this.failedRounds + 1 : 0;
    for (const uuid of failed) {
      if (this.names.isIncomplete(uuid)) this.pending.add(uuid);
    }
    if (this.pending.size > 0 && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.flush();
      }, this.retryDelay(this.failedRounds));
    }
  }
}
