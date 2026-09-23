// The "Open in draft" handoff: how a request body gets from the AD Network
// panel to the designer tab it opens, whose inputs it fills.
//
// The body never travels in the URL (a URL is logged, synced and shared).
// The panel stores it here under a random one-time id and puts only that id
// in the opened URL's fragment (`#belz-autofill=<id>`, see config/namespace.ts).
// The designer page asks the background for it; the background takes it out
// of storage (so it can be read once), checks its age, and answers. A link
// copied to someone else, or opened twice, finds nothing and fills nothing.
//
// Session storage, so a body never outlives the browser session; local
// storage on browsers without it, where the age check still bounds it.

import { AUTOFILL_HANDOFF_KEY_PREFIX as KEY_PREFIX } from '../config/storage-keys';

/** A handoff older than this is not used: the tab was opened too long ago. */
export const HANDOFF_TTL_MS = 5 * 60_000;

interface StoredHandoff {
  body: string;
  /** When the panel stored it (epoch ms). */
  ts: number;
}

function area(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local;
}

/** A random id: unguessable, and safe in a URL fragment. */
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ids look like newId(): anything else is not ours. */
export function isHandoffId(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id);
}

/** Panel side: store `body` and return the id to put in the URL. */
export async function storeHandoff(body: string): Promise<string> {
  const id = newId();
  const value: StoredHandoff = { body, ts: Date.now() };
  await area().set({ [KEY_PREFIX + id]: value });
  return id;
}

/**
 * Background side: the body stored under `id`, removed so it cannot be read
 * again; null when there is none or it is too old. Also drops any other
 * handoff that expired unread.
 */
export async function takeHandoff(id: string, now = Date.now()): Promise<string | null> {
  if (!isHandoffId(id)) return null;
  const store = area();
  const all = (await store.get(null)) as Record<string, unknown>;
  const expired = Object.keys(all).filter((key) => {
    if (!key.startsWith(KEY_PREFIX) || key === KEY_PREFIX + id) return false;
    const entry = all[key] as Partial<StoredHandoff> | null;
    return !entry || typeof entry.ts !== 'number' || now - entry.ts > HANDOFF_TTL_MS;
  });
  const key = KEY_PREFIX + id;
  const entry = all[key] as Partial<StoredHandoff> | undefined;
  await store.remove(entry ? [key, ...expired] : expired);
  if (!entry || typeof entry.body !== 'string' || typeof entry.ts !== 'number') return null;
  return now - entry.ts > HANDOFF_TTL_MS ? null : entry.body;
}
