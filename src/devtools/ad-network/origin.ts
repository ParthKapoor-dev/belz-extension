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
//
// It also answers the question every network-touching part of the panel asks
// first: is the inspected page on an allowed site? DevTools stays open when
// the tab navigates elsewhere, and on any other site the panel must not look
// up names, lift auth headers or patch the page's fetch.

import { isHostsChange, normalizeHost, readHosts } from '../../shared/hosts';
import { evalInPage } from '../inspected';
import { createLogger } from '../../shared/logger';

const log = createLogger('ad-network');

/** The page DevTools is inspecting, and where its designer UI lives. */
export class InspectedSite {
  private origin = '';
  private host = '';
  /** host → designer host, mirrored from the user's site list. */
  private readonly designerHostByHost = new Map<string, string>();
  /** The granted hosts of the user's site list. */
  private readonly enabled = new Set<string>();

  /** The inspected page's origin; '' until detect() has answered. */
  get apiOrigin(): string {
    return this.origin;
  }

  /** The inspected page's host, normalised (lowercase, no port); '' until detect() has answered. */
  get apiHost(): string {
    return this.host;
  }

  /** True when the inspected page is https and its host is a granted site. */
  get isAllowed(): boolean {
    return this.isAllowedOrigin(this.origin);
  }

  /** True when `origin` is https on a granted site. */
  isAllowedOrigin(origin: string): boolean {
    try {
      const url = new URL(origin);
      const host = normalizeHost(url.hostname);
      return url.protocol === 'https:' && host !== null && this.enabled.has(host);
    } catch {
      return false;
    }
  }

  /** The origin whose Automation Designer UI should be opened for this page. */
  get designerOrigin(): string {
    if (!this.host) return this.origin;
    const mapped = this.designerHostByHost.get(this.host);
    if (!mapped || mapped === this.host) return this.origin;
    try {
      const u = new URL(this.origin);
      u.hostname = mapped;
      return u.origin;
    } catch {
      return this.origin;
    }
  }

  /**
   * Read the inspected window's origin. Resolves once DevTools answers, with
   * the origin; an answer that is not an http(s) origin (about:blank, a
   * chrome:// page) forgets the previous one.
   */
  async detect(): Promise<string> {
    const result = await evalInPage('location.origin');
    const origin = typeof result === 'string' && /^https?:/i.test(result) ? result : '';
    let host = '';
    try {
      host = origin ? normalizeHost(new URL(origin).hostname) ?? '' : '';
    } catch {
      host = '';
    }
    this.origin = host ? origin : '';
    this.host = host;
    return this.origin;
  }

  /** Mirror the user's site list: granted hosts and designer-host overrides. */
  async loadSiteConfig(): Promise<void> {
    try {
      const hosts = await readHosts();
      this.designerHostByHost.clear();
      this.enabled.clear();
      for (const entry of hosts) {
        const host = normalizeHost(entry.host);
        if (!host) continue;
        if (entry.enabled) this.enabled.add(host);
        this.designerHostByHost.set(host, normalizeHost(entry.designerHost) ?? host);
      }
    } catch (err) {
      // No site list yet: nothing is allowed, and the designer origin falls
      // back to the api origin.
      log.debug('site list not loaded:', err);
    }
  }

  /**
   * Keep the mapping live while the panel is open. `onChange` runs after each
   * reload of the list. Returns the function that stops.
   */
  watchSiteConfig(onChange?: () => void): () => void {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (isHostsChange(changes, areaName)) void this.loadSiteConfig().then(() => onChange?.());
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }
}
