// The user's list of allowed sites, as stored in chrome.storage.local.
//
// Read by four worlds — background (script registration), options page (the
// editor), DevTools page (panel gating) and the AD Network panel (designer
// host overrides) — so the storage shape and its validation live here once.
//
// Stored shape, under HOSTS_STORAGE_KEY:
//   { hosts: [ { host, enabled, designerHost?, seeded?, addedAt? } ] }
//
// Stateless: every call reads storage afresh.

import { HOSTS_STORAGE_KEY } from '../config/storage-keys.js';

/**
 * A bare hostname from user input, or null when it is not one. Accepts a
 * scheme, path, query or port and strips them: "https://Host:8080/x" -> "host".
 */
export function normalizeHost(input) {
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

/** The match pattern a host's permission is granted for. */
export function originPattern(host) {
  return `https://${host}/*`;
}

/** Every stored entry with a usable `host`, in stored order. */
export async function readHosts() {
  const result = await chrome.storage.local.get(HOSTS_STORAGE_KEY);
  const raw = result && result[HOSTS_STORAGE_KEY];
  if (!raw || !Array.isArray(raw.hosts)) return [];
  return raw.hosts.filter((h) => h && typeof h.host === 'string');
}

/** Entries the extension should act on: not explicitly disabled. */
export async function readEnabledHosts() {
  return (await readHosts()).filter((h) => h.enabled !== false);
}

export async function writeHosts(hosts) {
  await chrome.storage.local.set({ [HOSTS_STORAGE_KEY]: { hosts } });
}

/** True when a storage.onChanged event touched the host list. */
export function isHostsChange(changes, areaName) {
  return areaName === 'local' && Boolean(changes[HOSTS_STORAGE_KEY]);
}
