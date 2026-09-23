// Registers the DevTools panels — "AD Network" and "PD Inspector".
//
// Runs in the devtools-page context (one per open DevTools window). It only
// registers the panels; all logic lives in the panel pages (ad-network/,
// pd-inspector/), which the browser loads when the user first opens each
// panel tab.
//
// The panel pages (`panel.html`, `panel-pd.html`) live at the extension root
// (not under dist/): Chromium resolves these paths relative to the extension
// root, but Firefox resolves them relative to the devtools page — a
// `dist/panel.html` would become `dist/dist/panel.html` there and load blank.
//
// Panels are gated to the user's allowed-sites list. Without this check the
// AD Network + PD Inspector tabs would appear in DevTools on every site
// (YouTube, chrome://newtab, etc.) because `devtools_page` runs per-DevTools-
// window, not per-host. We check on init and again on navigation so panels
// appear the moment the user reaches an allowed site.

import { isHostsChange, readEnabledHosts } from '../shared/hosts';
import { evalInPage } from './inspected';
import { createLogger } from '../shared/logger';

const log = createLogger('devtools');

const PANELS = [
  { title: 'AD Network', page: 'panel.html' },
  { title: 'PD Inspector', page: 'panel-pd.html' }
];

/** The inspected page's lowercase host; '' when DevTools cannot tell. */
async function currentHost(): Promise<string> {
  const result = await evalInPage('location.host');
  return typeof result === 'string' ? result.toLowerCase() : '';
}

/** The granted hosts from the user's site list, lowercased. */
async function allowedHosts(): Promise<Set<string>> {
  try {
    return new Set((await readEnabledHosts()).map((h) => h.host.toLowerCase()));
  } catch (err) {
    log.warn('cannot read the allowed sites:', err);
    return new Set();
  }
}

/**
 * Adds the panels to this DevTools window, once, when it inspects an allowed
 * site. DevTools has no API to remove a panel, so stop() only stops watching:
 * panels already created stay.
 */
export class PanelRegistrar {
  /** Titles already registered: a panel is created once per DevTools window. */
  private readonly created = new Set<string>();
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.tryCreate();
    // If DevTools was opened on a non-allowed page and the user then
    // navigates the same tab to an allowed host, create the panels now — this
    // is the only path to a panel-visible state without closing and reopening
    // DevTools.
    chrome.devtools.network.onNavigated.addListener(this.onNavigated);
    // Same for a host added to the allowed list via the options page while
    // DevTools is already open.
    chrome.storage.onChanged.addListener(this.onStorageChanged);
  }

  stop(): void {
    this.started = false;
    chrome.devtools.network.onNavigated.removeListener(this.onNavigated);
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
  }

  private readonly onNavigated = (): void => {
    void this.tryCreate();
  };

  private readonly onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (isHostsChange(changes, areaName)) void this.tryCreate();
  };

  private async tryCreate(): Promise<void> {
    if (this.created.size === PANELS.length) return;
    const [host, allowed] = await Promise.all([currentHost(), allowedHosts()]);
    if (!this.started || !host || !allowed.has(host)) return;
    for (const { title, page } of PANELS) {
      if (this.created.has(title)) continue;
      this.created.add(title);
      chrome.devtools.panels.create(title, '', page, () => {
        if (chrome.runtime.lastError) {
          this.created.delete(title);
          log.error(`panel "${title}" failed to register:`, chrome.runtime.lastError);
        }
      });
    }
  }
}
