// Stale-while-revalidate cache for AD method metadata.
//
// The AD Network panel resolves a lot of the same uuids over and over — the
// same handful of methods fire on every page interaction. Without a cache
// every panel open would re-hit the platform API for names we already know.
//
// Entries are keyed by `<origin>|<uuid>` so the same uuid on two environments
// (dev vs qa) never collides. Reads are served from an in-memory mirror that
// is hydrated once per panel; writes go to chrome.storage.local so the cache
// survives DevTools reopens and browser restarts.
//
// SWR semantics mirror what a definition fetch costs: a FRESH entry is used
// as-is, a STALE entry is returned immediately AND revalidated in the
// background, an expired entry is dropped.

import { AD_CACHE_STORAGE_KEY } from '../../config/storage-keys';
import { createLogger } from '../../shared/logger';
import type { MethodSummary } from './types';

const log = createLogger('ad-network');

/** A cached summary and when it was written (epoch ms). */
export interface CacheEntry extends MethodSummary {
  ts: number;
}

/** Younger than this: use without revalidating. */
const FRESH_MS = 6 * 60 * 60 * 1000; // 6h
/** Older than this: treat as a miss. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14d
/** Hard cap — oldest entries are evicted first. */
const MAX_ENTRIES = 800;
/** Coalesce rapid writes into one storage round-trip. */
const FLUSH_DEBOUNCE_MS = 400;

function keyFor(origin: string, uuid: string): string {
  return `${origin}|${uuid}`;
}

export class MethodCache {
  private readonly mem = new Map<string, CacheEntry>();
  private hydrating: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Load the persisted cache into memory. Idempotent; safe to await repeatedly. */
  hydrate(): Promise<void> {
    this.hydrating ??= (async () => {
      try {
        const result = await chrome.storage.local.get(AD_CACHE_STORAGE_KEY);
        const raw = result[AD_CACHE_STORAGE_KEY] as { entries?: Record<string, CacheEntry | null> } | undefined;
        const now = Date.now();
        if (raw && raw.entries && typeof raw.entries === 'object') {
          for (const [k, v] of Object.entries(raw.entries)) {
            if (!v || typeof v.ts !== 'number') continue;
            if (now - v.ts > MAX_AGE_MS) continue; // expired on load
            this.mem.set(k, v);
          }
        }
      } catch (err) {
        log.debug('method cache not loaded, starting empty:', err);
      }
    })();
    return this.hydrating;
  }

  /** Read a cached summary; null on a miss or an expired entry. */
  read(origin: string, uuid: string): { data: CacheEntry; stale: boolean } | null {
    const hit = this.mem.get(keyFor(origin, uuid));
    if (!hit) return null;
    const age = Date.now() - hit.ts;
    if (age > MAX_AGE_MS) {
      this.mem.delete(keyFor(origin, uuid));
      return null;
    }
    return { data: hit, stale: age > FRESH_MS };
  }

  /** Store a resolved summary. Silently no-ops on an empty summary. */
  write(origin: string, uuid: string, summary: Partial<MethodSummary> | null): void {
    if (!summary || (!summary.name && !summary.category)) return;
    this.mem.set(keyFor(origin, uuid), {
      name: summary.name || null,
      category: summary.category || null,
      state: summary.state || null,
      referenceId: summary.referenceId || null,
      ts: Date.now()
    });
    this.scheduleFlush();
  }

  /** Drop everything, in memory and in storage. */
  async clear(): Promise<void> {
    this.mem.clear();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    try {
      await chrome.storage.local.remove(AD_CACHE_STORAGE_KEY);
    } catch (err) {
      log.warn('clearing the method cache failed:', err);
    }
  }

  /** Number of cached methods. */
  get size(): number {
    return this.mem.size;
  }

  private evictIfNeeded(): void {
    if (this.mem.size <= MAX_ENTRIES) return;
    const sorted = Array.from(this.mem.entries()).sort((a, b) => a[1].ts - b[1].ts);
    const drop = this.mem.size - MAX_ENTRIES;
    for (const [key] of sorted.slice(0, drop)) this.mem.delete(key);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.evictIfNeeded();
      const entries: Record<string, CacheEntry> = {};
      for (const [k, v] of this.mem) entries[k] = v;
      chrome.storage.local.set({ [AD_CACHE_STORAGE_KEY]: { entries } }).catch((err: unknown) => {
        // Quota or storage gone: the in-memory cache still works.
        log.warn('saving the method cache failed:', err);
      });
    }, FLUSH_DEBOUNCE_MS);
  }
}
