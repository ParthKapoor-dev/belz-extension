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
// Several DevTools windows share the one stored map, so a flush writes only
// the entries this panel changed, merged into what is stored now (newest
// entry wins per key), rather than overwriting the map with its own copy.
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
export const FRESH_MS = 6 * 60 * 60 * 1000; // 6h
/** Older than this: treat as a miss. */
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14d
/** Hard cap — oldest entries are evicted first. */
export const MAX_ENTRIES = 800;
/** Coalesce rapid writes into one storage round-trip. */
const FLUSH_DEBOUNCE_MS = 400;

type StoredEntries = Record<string, CacheEntry | null>;

function keyFor(origin: string, uuid: string): string {
  return `${origin}|${uuid}`;
}

const isEntry = (value: unknown): value is CacheEntry =>
  Boolean(value) && typeof (value as CacheEntry).ts === 'number';

async function readStored(): Promise<StoredEntries> {
  const result = await chrome.storage.local.get(AD_CACHE_STORAGE_KEY);
  const raw = result[AD_CACHE_STORAGE_KEY] as { entries?: StoredEntries } | undefined;
  return raw?.entries && typeof raw.entries === 'object' ? raw.entries : {};
}

/** The `MAX_ENTRIES` newest unexpired entries of `entries`. */
function prune(entries: Map<string, CacheEntry>, now: number): Map<string, CacheEntry> {
  const live = [...entries].filter(([, v]) => now - v.ts <= MAX_AGE_MS);
  live.sort((a, b) => b[1].ts - a[1].ts);
  return new Map(live.slice(0, MAX_ENTRIES));
}

export class MethodCache {
  private readonly mem = new Map<string, CacheEntry>();
  /** Keys written since the last flush: the only ones a flush stores. */
  private readonly dirty = new Set<string>();
  private hydrating: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();

  /** Load the persisted cache into memory. Idempotent; safe to await repeatedly. */
  hydrate(): Promise<void> {
    this.hydrating ??= (async () => {
      try {
        const now = Date.now();
        for (const [k, v] of Object.entries(await readStored())) {
          if (!isEntry(v) || now - v.ts > MAX_AGE_MS) continue; // expired on load
          this.mem.set(k, v);
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
    const key = keyFor(origin, uuid);
    this.mem.set(key, {
      name: summary.name || null,
      category: summary.category || null,
      state: summary.state || null,
      referenceId: summary.referenceId || null,
      ts: Date.now()
    });
    this.dirty.add(key);
    this.scheduleFlush();
  }

  /** Drop everything, in memory and in storage. */
  async clear(): Promise<void> {
    this.mem.clear();
    this.dirty.clear();
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

  /**
   * Write the pending changes now (a flush is otherwise debounced). Resolves
   * once they are stored.
   */
  flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    // One flush at a time, so two of this panel's never interleave either.
    this.flushing = this.flushing.then(() => this.writeDirty());
    return this.flushing;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DEBOUNCE_MS);
  }

  /** Read-modify-write: our changed entries into what is stored now, newest wins. */
  private async writeDirty(): Promise<void> {
    if (this.dirty.size === 0) return;
    const keys = [...this.dirty];
    this.dirty.clear();
    try {
      const merged = new Map<string, CacheEntry>();
      for (const [k, v] of Object.entries(await readStored())) if (isEntry(v)) merged.set(k, v);
      for (const key of keys) {
        const mine = this.mem.get(key);
        const theirs = merged.get(key);
        if (mine && (!theirs || mine.ts >= theirs.ts)) merged.set(key, mine);
      }
      const kept = prune(merged, Date.now());
      // Learn what other windows stored meanwhile, and forget what was evicted.
      for (const [k, v] of kept) {
        const mine = this.mem.get(k);
        if (!mine || v.ts > mine.ts) this.mem.set(k, v);
      }
      for (const k of [...this.mem.keys()]) if (!kept.has(k)) this.mem.delete(k);
      await chrome.storage.local.set({ [AD_CACHE_STORAGE_KEY]: { entries: Object.fromEntries(kept) } });
    } catch (err) {
      // Quota or storage gone: the in-memory cache still works.
      log.warn('saving the method cache failed:', err);
    }
  }
}
