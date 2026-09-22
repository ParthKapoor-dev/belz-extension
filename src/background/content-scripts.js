// Content-script registration, reconciled against the user's host list.
//
// The manifest declares no content scripts: which sites the extension runs on
// is the user's choice, made on the options page. On startup and whenever the
// list changes, reconcileContentScripts() makes the registered scripts match
// it — three per enabled host (AD, PD, PD Inspector) with stable ids.

import { HOSTS_STORAGE_KEY } from '../config/storage-keys.js';
import { AD_ROUTE_PREFIX, PD_ROUTE_PREFIX, PAGES_ROUTE_PREFIX } from '../config/routes.js';
import { readEnabledHosts } from '../shared/hosts.js';

// Each granted host gets three registrations — AD, PD, PD-Inspector — matching
// the routes the old static manifest declared.
export const CONTENT_SCRIPT_TEMPLATES = [
  { key: 'ad', path: `${AD_ROUTE_PREFIX}*`, js: 'dist/ad-content.js' },
  { key: 'pd', path: `${PD_ROUTE_PREFIX}*`, js: 'dist/pd-content.js' },
  { key: 'pdi', path: `${PAGES_ROUTE_PREFIX}*`, js: 'dist/pd-inspector.js' }
];

/** The registration for one host and one template. */
export function scriptForHost(host, template) {
  return {
    id: `${template.key}-${host}`,
    matches: [`https://${host}${template.path}`],
    js: [template.js],
    runAt: 'document_idle',
    world: 'ISOLATED'
  };
}

async function currentRegistrations() {
  try {
    return await chrome.scripting.getRegisteredContentScripts();
  } catch {
    return [];
  }
}

export async function reconcileContentScripts() {
  const want = [];
  for (const entry of await readEnabledHosts()) {
    for (const template of CONTENT_SCRIPT_TEMPLATES) {
      want.push(scriptForHost(entry.host, template));
    }
  }
  const wantIds = new Set(want.map((s) => s.id));

  const registered = await currentRegistrations();
  const registeredIds = new Set(registered.map((s) => s.id));

  const toRemove = registered
    .map((s) => s.id)
    .filter((id) => !wantIds.has(id));
  const toAdd = want.filter((s) => !registeredIds.has(s.id));
  const toUpdate = want.filter((s) => registeredIds.has(s.id));

  try {
    if (toRemove.length) {
      await chrome.scripting.unregisterContentScripts({ ids: toRemove });
    }
    if (toAdd.length) {
      await chrome.scripting.registerContentScripts(toAdd);
    }
    if (toUpdate.length) {
      // Update covers the case where the manifest paths / template shape
      // changed under an existing host (e.g. new content script variant).
      await chrome.scripting.updateContentScripts(toUpdate);
    }
  } catch (err) {
    console.error('[belz-extension] content script reconcile failed:', err);
  }
}

// ---- first-install seeding ------------------------------------------------
// Browsers clear an extension's storage when it is uninstalled, and loading a
// temporary add-on in Firefox uninstalls the previous copy — so a rebuild and
// re-add cycle loses the site list every time. If the user keeps a
// sites.default.json in the extension root (see the .example), we restore the
// list from it whenever storage comes up empty.
//
// Seeded entries are marked enabled:false. The host permission itself cannot
// be restored this way — only a user gesture can grant it — so the options
// page shows these with a Grant button and flips enabled to true once the
// browser confirms the grant.
export async function seedHostsIfEmpty() {
  try {
    const stored = await chrome.storage.local.get(HOSTS_STORAGE_KEY);
    // Distinguish "never seeded" from "user deliberately emptied the list".
    if (stored && stored[HOSTS_STORAGE_KEY]) return;

    const res = await fetch(chrome.runtime.getURL('sites.default.json'));
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !Array.isArray(data.hosts)) return;

    const hosts = [];
    for (const entry of data.hosts) {
      if (!entry || typeof entry.host !== 'string' || !entry.host.trim()) continue;
      const host = entry.host.trim().toLowerCase();
      const seeded = { host, enabled: false, seeded: true };
      if (typeof entry.designerHost === 'string' && entry.designerHost.trim()) {
        seeded.designerHost = entry.designerHost.trim().toLowerCase();
      }
      hosts.push(seeded);
    }
    if (!hosts.length) return;

    await chrome.storage.local.set({ [HOSTS_STORAGE_KEY]: { hosts } });
    console.info(
      `[belz-extension] seeded ${hosts.length} site(s) from sites.default.json — ` +
        'open the options page to grant them.'
    );
  } catch {
    /* no seed file, or it is malformed — start empty */
  }
}
