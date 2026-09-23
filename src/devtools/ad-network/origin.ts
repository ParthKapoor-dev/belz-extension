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
import { createLogger } from '../../shared/logger';

const log = createLogger('ad-network');

/** The page DevTools is inspecting, and where its designer UI lives. */
export class InspectedSite {
  private origin = '';
  private host = '';
  /** lowercase host → designer host, mirrored from the user's site list. */
  private readonly designerHostByHost = new Map<string, string>();

  /** The inspected page's origin; '' until detect() has answered. */
  get apiOrigin(): string {
    return this.origin;
  }

  /** The inspected page's lowercase host; '' until detect() has answered. */
  get apiHost(): string {
    return this.host;
  }

  /** The origin whose Automation Designer UI should be opened for this page. */
  get designerOrigin(): string {
    if (!this.host) return this.origin;
    const mapped = this.designerHostByHost.get(this.host);
    if (!mapped || mapped === this.host) return this.origin;
    try {
      const u = new URL(this.origin);
      u.host = mapped;
      return u.origin;
    } catch {
      return this.origin;
    }
  }

  /** Read the inspected window's origin. Resolves once DevTools answers. */
  async detect(): Promise<string> {
    const result = await evalInPage('location.origin');
    if (typeof result === 'string' && /^https?:/i.test(result)) {
      this.origin = result;
      try {
        this.host = new URL(result).host.toLowerCase();
      } catch {
        this.host = '';
      }
    }
    return this.origin;
  }

  /** Mirror the user's site list so designer-host overrides are available. */
  async loadSiteConfig(): Promise<void> {
    try {
      const hosts = await readHosts();
      this.designerHostByHost.clear();
      for (const entry of hosts) {
        const designer =
          typeof entry.designerHost === 'string' && entry.designerHost.trim()
            ? entry.designerHost.trim().toLowerCase()
            : entry.host.toLowerCase();
        this.designerHostByHost.set(entry.host.toLowerCase(), designer);
      }
    } catch (err) {
      // No site list yet: the designer origin falls back to the api origin.
      log.debug('site list not loaded:', err);
    }
  }

  /** Keep the mapping live while the panel is open. */
  watchSiteConfig(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (isHostsChange(changes, areaName)) this.loadSiteConfig();
    });
  }
}
