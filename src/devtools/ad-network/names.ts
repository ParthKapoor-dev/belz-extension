// Method names and categories in the AD Network panel: what is known so far,
// and the queue that asks the platform for the rest.

import type { MethodResolver } from './api';
import type { MethodSummary } from './types';
import { errorText } from './format';
import { createLogger } from '../../shared/logger';

const log = createLogger('ad-network');

const RESOLVE_DEBOUNCE_MS = 250;
const RESOLVE_RETRY_MS = 4000;
/** Never hammer the platform with a burst — resolve a few uuids at a time. */
const RESOLVE_CONCURRENCY = 4;

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
 * paints instantly. A uuid that fails for transport/auth reasons goes back on
 * the queue and is retried later — the user may still be signing in, or the
 * page may not have fired an authenticated request yet for us to lift a token
 * from.
 */
export class ResolveQueue {
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param ready Settles once the origin, site list and cache are loaded.
   * @param onOutcome Told after each batch whether names are unavailable, and why.
   */
  constructor(
    private readonly resolver: MethodResolver,
    private readonly names: MethodNames,
    private readonly ready: Promise<void>,
    private readonly onOutcome: (failed: boolean, reason: string) => void
  ) {}

  add(uuid: string): void {
    if (!this.names.isIncomplete(uuid)) return;
    this.pending.add(uuid);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.flush();
    }, RESOLVE_DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    await this.ready;
    const uuids = [...this.pending].filter((uuid) => this.names.isIncomplete(uuid));
    this.pending.clear();
    if (uuids.length === 0) return;

    const failed: string[] = [];
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
          this.names.apply(uuid, summary);
        } catch (err) {
          lastError = err;
          log.warn('resolve failed for ' + uuid, err);
          failed.push(uuid);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, uuids.length) }, worker));

    this.onOutcome(failed.length > 0, errorText(lastError));
    for (const uuid of failed) {
      if (this.names.isIncomplete(uuid)) this.pending.add(uuid);
    }
    if (this.pending.size > 0 && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.flush();
      }, RESOLVE_RETRY_MS);
    }
  }
}
