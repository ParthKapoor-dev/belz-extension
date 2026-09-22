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

import { isHostsChange, readHosts } from '../../shared/hosts';
import { evalInPage } from '../inspected';

let apiOrigin = '';
let apiHost = '';
/** lowercase host → designer host, mirrored from the user's site list. */
const designerHostByHost = new Map<string, string>();

export function getApiOrigin(): string {
  return apiOrigin;
}

export function getApiHost(): string {
  return apiHost;
}

/** The origin whose Automation Designer UI should be opened for this page. */
export function getDesignerOrigin(): string {
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

/** Read the inspected window's origin. Resolves once DevTools answers. */
export async function detectOrigin(): Promise<string> {
  const result = await evalInPage('location.origin');
  if (typeof result === 'string' && /^https?:/i.test(result)) {
    apiOrigin = result;
    try {
      apiHost = new URL(result).host.toLowerCase();
    } catch {
      apiHost = '';
    }
  }
  return apiOrigin;
}

/** Mirror the user's site list so designer-host overrides are available. */
export async function loadSiteConfig(): Promise<void> {
  try {
    const hosts = await readHosts();
    designerHostByHost.clear();
    for (const entry of hosts) {
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
export function watchSiteConfig(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (isHostsChange(changes, areaName)) loadSiteConfig();
  });
}
