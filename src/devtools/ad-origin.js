// Origin resolution for the AD Network panel.
//
// Two origins matter and they are not always the same:
//
//   apiOrigin      — where we read method metadata from. This is simply the
//                    inspected window's own origin: whatever host fired the
//                    chain request is the host that can answer questions
//                    about it, using the session the page already holds.
//
//   designerOrigin — where the Automation Designer UI lives. On most
//                    deployments this equals apiOrigin. On split
//                    public/staff-portal setups the designer only exists on
//                    the staff portal, so the user records that mapping once
//                    per site in the options page (`designerHost`) and we
//                    read it from there. Nothing is hardcoded.

import { HOSTS_STORAGE_KEY } from '../config/storage-keys.js';

let apiOrigin = '';
let apiHost = '';
/** lowercase host → designer host, mirrored from the user's site list. */
const designerHostByHost = new Map();

export function getApiOrigin() {
  return apiOrigin;
}

export function getApiHost() {
  return apiHost;
}

/** The origin whose Automation Designer UI should be opened for this page. */
export function getDesignerOrigin() {
  if (!apiHost) return apiOrigin;
  const mapped = designerHostByHost.get(apiHost);
  if (!mapped || mapped === apiHost) return apiOrigin;
  try {
    const u = new URL(apiOrigin);
    u.host = mapped;
    return u.origin;
  } catch {
    return apiOrigin;
  }
}

/**
 * Rewrite any same-instance URL onto the designer origin. Used so a link
 * observed on a public portal opens on the staff portal that actually serves
 * the designer.
 */
export function toDesignerUrl(url) {
  try {
    const u = new URL(url, apiOrigin || undefined);
    const designer = new URL(getDesignerOrigin());
    u.protocol = designer.protocol;
    u.host = designer.host;
    return u.toString();
  } catch {
    return url;
  }
}

/** Read the inspected window's origin. Resolves once DevTools answers. */
export function detectOrigin() {
  return new Promise((resolve) => {
    try {
      chrome.devtools.inspectedWindow.eval('location.origin', (result) => {
        if (typeof result === 'string' && /^https?:/i.test(result)) {
          apiOrigin = result;
          try {
            apiHost = new URL(result).host.toLowerCase();
          } catch {
            apiHost = '';
          }
        }
        resolve(apiOrigin);
      });
    } catch {
      resolve(apiOrigin);
    }
  });
}

/** Mirror the user's site list so designer-host overrides are available. */
export async function loadSiteConfig() {
  try {
    const result = await chrome.storage.local.get(HOSTS_STORAGE_KEY);
    const raw = result && result[HOSTS_STORAGE_KEY];
    if (!raw || !Array.isArray(raw.hosts)) return;
    designerHostByHost.clear();
    for (const entry of raw.hosts) {
      if (!entry || typeof entry.host !== 'string') continue;
      const designer =
        typeof entry.designerHost === 'string' && entry.designerHost.trim()
          ? entry.designerHost.trim().toLowerCase()
          : entry.host.toLowerCase();
      designerHostByHost.set(entry.host.toLowerCase(), designer);
    }
  } catch {
    /* no site list yet — designer origin falls back to the api origin */
  }
}

/** Keep the mapping live while the panel is open. */
export function watchSiteConfig() {
  if (!chrome.storage || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[HOSTS_STORAGE_KEY]) loadSiteConfig();
  });
}
