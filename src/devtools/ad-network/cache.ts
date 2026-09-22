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
import type { MethodSummary } from './types';

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

const mem = new Map<string, CacheEntry>();
let hydrated = false;
let hydrating: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function keyFor(origin: string, uuid: string): string {
  return `${origin}|${uuid}`;
}

/** Load the persisted cache into memory. Idempotent; safe to await repeatedly. */
export function hydrate(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const result = await chrome.storage.local.get(AD_CACHE_STORAGE_KEY);
      const raw = result[AD_CACHE_STORAGE_KEY] as { entries?: Record<string, CacheEntry | null> } | undefined;
      const now = Date.now();
      if (raw && raw.entries && typeof raw.entries === 'object') {
        for (const [k, v] of Object.entries(raw.entries)) {
          if (!v || typeof v.ts !== 'number') continue;
          if (now - v.ts > MAX_AGE_MS) continue; // expired on load
          mem.set(k, v);
        }
      }
    } catch {
      /* first run, or storage unavailable — start empty */
    }
    hydrated = true;
    hydrating = null;
  })();
  return hydrating;
}

function evictIfNeeded(): void {
  if (mem.size <= MAX_ENTRIES) return;
  const sorted = Array.from(mem.entries()).sort((a, b) => a[1].ts - b[1].ts);
  const drop = mem.size - MAX_ENTRIES;
  for (const [key] of sorted.slice(0, drop)) mem.delete(key);
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    evictIfNeeded();
    const entries: Record<string, CacheEntry> = {};
    for (const [k, v] of mem) entries[k] = v;
    try {
      chrome.storage.local.set({ [AD_CACHE_STORAGE_KEY]: { entries } });
    } catch {
      /* quota or storage gone — the in-memory cache still works */
    }
  }, FLUSH_DEBOUNCE_MS);
}

/** Read a cached summary; null on a miss or an expired entry. */
export function read(origin: string, uuid: string): { data: CacheEntry; stale: boolean } | null {
  const hit = mem.get(keyFor(origin, uuid));
  if (!hit) return null;
  const age = Date.now() - hit.ts;
  if (age > MAX_AGE_MS) {
    mem.delete(keyFor(origin, uuid));
    return null;
  }
  return { data: hit, stale: age > FRESH_MS };
}

/** Store a resolved summary. Silently no-ops on an empty summary. */
export function write(origin: string, uuid: string, summary: Partial<MethodSummary> | null): void {
  if (!summary || (!summary.name && !summary.category)) return;
  mem.set(keyFor(origin, uuid), {
    name: summary.name || null,
    category: summary.category || null,
    state: summary.state || null,
    referenceId: summary.referenceId || null,
    ts: Date.now()
  });
  scheduleFlush();
}

/** Drop everything — wired to the panel's Clear button's long-press affordance. */
export async function clear(): Promise<void> {
  mem.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    await chrome.storage.local.remove(AD_CACHE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Number of cached methods — surfaced in the panel footer. */
export function size(): number {
  return mem.size;
}
