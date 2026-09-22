// The user's list of allowed sites, as stored in chrome.storage.local.
//
// Read by four worlds — background (script registration), options page (the
// editor), DevTools page (panel gating) and the AD Network panel (designer
// host overrides) — so the storage shape and its validation live here once.
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

/** A match pattern for `path` on `host`; the whole site by default. */
export function hostPattern(host: string, path = '/*'): string {
  return `https://${host}${path}`;
}

/** The match pattern a host's permission is granted for. */
export function originPattern(host: string): string {
  return hostPattern(host);
}

function isHostEntry(value: unknown): value is HostEntry {
  return Boolean(value) && typeof (value as HostEntry).host === 'string';
}

/** Every stored entry with a usable `host`, in stored order. */
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

export async function writeHosts(hosts: HostEntry[]): Promise<void> {
  const value: StoredHosts = { hosts };
  await chrome.storage.local.set({ [HOSTS_STORAGE_KEY]: value });
}

/** True when a storage.onChanged event touched the host list. */
export function isHostsChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
): boolean {
  return areaName === 'local' && Boolean(changes[HOSTS_STORAGE_KEY]);
}
