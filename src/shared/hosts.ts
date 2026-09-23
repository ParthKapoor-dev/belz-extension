// The user's list of allowed sites, as stored in chrome.storage.local.
//
// Read by four worlds — background (script registration, grant sync),
// options page (the editor), DevTools page (panel gating) and the AD Network
// panel (allowed-site check, designer host overrides) — so the storage shape,
// its validation and the allowed-site check live here once.
//
// Stateless: every call reads storage afresh.

import { HOSTS_STORAGE_KEY } from '../config/storage-keys';

/** One allowed site. */
export interface HostEntry {
  /** Bare lowercase hostname, e.g. "nsm-dev.example.com". */
  host: string;
  /**
   * Whether the browser has granted this host. `false` for an entry restored
   * from sites.default.json and not yet granted.
   */
  enabled: boolean;
  /** Host that serves the Automation Designer UI, when it differs. */
  designerHost?: string;
  /** Restored from sites.default.json and never granted since. */
  seeded?: boolean;
  /** When the user added it (epoch ms). */
  addedAt?: number;
}

/** What is stored under HOSTS_STORAGE_KEY. */
export interface StoredHosts {
  hosts: HostEntry[];
}

/**
 * A bare hostname from user input, or null when it is not one. Accepts a
 * scheme, path, query or port and strips them: "https://Host:8080/x" -> "host".
 */
export function normalizeHost(input: string | null | undefined): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  const withoutScheme = raw.replace(/^https?:\/\//i, '');
  const noPath = withoutScheme.replace(/[/?#].*$/, '');
  const noPort = noPath.replace(/:.*$/, '');
  const host = noPort.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) {
    return null;
  }
  return host;
}

/**
 * A match pattern for `path` on `host`; the whole site by default, which is
 * also the pattern a host's permission is requested and checked for. Always
 * https: the extension never asks for plain-http access.
 */
export function hostPattern(host: string, path = '/*'): string {
  return `https://${host}${path}`;
}

/**
 * The host of an https URL, normalised like the stored list; null for any
 * other scheme or an unparsable URL.
 */
export function httpsHostOf(url: string | null | undefined): string | null {
  try {
    const parsed = new URL(url || '');
    return parsed.protocol === 'https:' ? normalizeHost(parsed.hostname) : null;
  } catch {
    return null;
  }
}

/**
 * True when `url` (a URL or an origin) is https on one of the `allowed`
 * hosts, as enabledHostSet() returns them. The one allowed-site check every
 * world uses.
 */
export function isAllowedUrl(url: string | null | undefined, allowed: ReadonlySet<string>): boolean {
  const host = httpsHostOf(url);
  return host !== null && allowed.has(host);
}

function isHostEntry(value: unknown): value is HostEntry {
  const entry = value as Partial<HostEntry> | null;
  return Boolean(entry) && typeof entry!.host === 'string' && typeof entry!.enabled === 'boolean';
}

/** Every stored entry with a usable `host` and an `enabled` flag, in stored order. */
export async function readHosts(): Promise<HostEntry[]> {
  const result = await chrome.storage.local.get(HOSTS_STORAGE_KEY);
  const raw = result[HOSTS_STORAGE_KEY] as Partial<StoredHosts> | undefined;
  if (!raw || !Array.isArray(raw.hosts)) return [];
  return raw.hosts.filter(isHostEntry);
}

/** Entries the extension should act on: granted. */
export async function readEnabledHosts(): Promise<HostEntry[]> {
  return (await readHosts()).filter((h) => h.enabled === true);
}

/** The granted hosts, normalised. */
export async function enabledHostSet(): Promise<Set<string>> {
  const set = new Set<string>();
  for (const entry of await readEnabledHosts()) {
    const host = normalizeHost(entry.host);
    if (host) set.add(host);
  }
  return set;
}

export async function writeHosts(hosts: HostEntry[]): Promise<void> {
  const value: StoredHosts = { hosts };
  await chrome.storage.local.set({ [HOSTS_STORAGE_KEY]: value });
}

/** Whether the browser holds the permission for `host` now; false when it cannot tell. */
async function isGranted(host: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [hostPattern(host)] });
  } catch {
    return false;
  }
}

/**
 * Store each host's `enabled` flag as the browser reports its permission:
 * the browser, not storage, is the authority. A granted seeded entry also
 * loses its `seeded` mark. The grants are asked first and the list is then
 * read and written back at once, so the window in which another write could
 * be overwritten is one storage round-trip. Resolves with each listed
 * host's grant.
 */
export async function syncEnabledFlags(): Promise<Map<string, boolean>> {
  const grants = new Map<string, boolean>();
  for (const entry of await readHosts()) grants.set(entry.host, await isGranted(entry.host));
  const stored = await readHosts();
  let changed = false;
  for (const entry of stored) {
    const granted = grants.get(entry.host);
    if (granted === undefined || entry.enabled === granted) continue;
    entry.enabled = granted;
    if (granted) delete entry.seeded;
    changed = true;
  }
  if (changed) await writeHosts(stored);
  return grants;
}

/** True when a storage.onChanged event touched the host list. */
export function isHostsChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
): boolean {
  return areaName === 'local' && Boolean(changes[HOSTS_STORAGE_KEY]);
}
