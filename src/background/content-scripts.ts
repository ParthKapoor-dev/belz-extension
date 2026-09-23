// Content-script registration, reconciled against the user's host list.
//
// The manifest declares no content scripts: which sites the extension runs on
// is the user's choice, made on the options page. On startup and whenever the
// list changes, ContentScriptSync makes the registered scripts match it —
// three per enabled host (AD, PD, PD Inspector) with stable ids.
//
// Reconciles never overlap. Two at once (an install and a storage change
// arriving together, say) would both see a script missing and both register
// it, and the second would fail with "Duplicate script ID". So they run one
// after another, and requests that arrive while one runs are coalesced into a
// single follow-up run, which reads the list afresh: the latest list wins.

import { HOSTS_STORAGE_KEY } from '../config/storage-keys';
import { AD_ROUTE_PREFIX, PD_ROUTE_PREFIX, PAGES_ROUTE_PREFIX } from '../config/routes';
import { CONTENT_SCRIPT_FILES, SITES_SEED_FILE } from '../config/extension-files';
import {
  hostPattern,
  isHostsChange,
  normalizeHost,
  readEnabledHosts,
  writeHosts,
  type HostEntry
} from '../shared/hosts';
import { createLogger } from '../shared/logger';

const log = createLogger('background');

interface ScriptTemplate {
  /** Id prefix: the registration id is `<key>-<host>`. */
  key: string;
  /** Path pattern under the host. */
  path: string;
  /** The script file, relative to the extension root. */
  js: string;
}

// Each granted host gets three registrations — AD, PD, PD-Inspector — one per
// route the extension acts on.
export const CONTENT_SCRIPT_TEMPLATES: readonly ScriptTemplate[] = [
  { key: 'ad', path: `${AD_ROUTE_PREFIX}*`, js: CONTENT_SCRIPT_FILES.ad },
  { key: 'pd', path: `${PD_ROUTE_PREFIX}*`, js: CONTENT_SCRIPT_FILES.pd },
  { key: 'pdi', path: `${PAGES_ROUTE_PREFIX}*`, js: CONTENT_SCRIPT_FILES.pdInspector }
];

type Registration = chrome.scripting.RegisteredContentScript;

/** The registration for one host and one template. */
export function scriptForHost(host: string, template: ScriptTemplate): Registration {
  return {
    id: `${template.key}-${host}`,
    matches: [hostPattern(host, template.path)],
    js: [template.js],
    runAt: 'document_idle',
    world: 'ISOLATED'
  };
}

async function currentRegistrations(): Promise<Registration[]> {
  try {
    return await chrome.scripting.getRegisteredContentScripts();
  } catch (err) {
    log.warn('cannot list the registered content scripts:', err);
    return [];
  }
}

const isDuplicateId = (err: unknown): boolean => /duplicate script id/i.test(String((err as Error)?.message ?? err));

/**
 * Register `scripts`. The call is all-or-nothing, so when one id turns out to
 * be registered already (the list we read was out of date), each script is
 * retried alone and an existing one is updated instead.
 */
async function register(scripts: Registration[]): Promise<void> {
  if (!scripts.length) return;
  try {
    await chrome.scripting.registerContentScripts(scripts);
    return;
  } catch (err) {
    if (!isDuplicateId(err)) throw err;
  }
  for (const script of scripts) {
    try {
      await chrome.scripting.registerContentScripts([script]);
    } catch (err) {
      if (!isDuplicateId(err)) throw err;
      await chrome.scripting.updateContentScripts([script]);
    }
  }
}

/**
 * One pass: make the registered scripts match the enabled hosts. Prefer
 * ContentScriptSync.reconcile(), which never runs two passes at once.
 */
export async function reconcileContentScripts(): Promise<void> {
  const want: Registration[] = [];
  for (const entry of await readEnabledHosts()) {
    const host = normalizeHost(entry.host);
    if (!host) continue;
    for (const template of CONTENT_SCRIPT_TEMPLATES) want.push(scriptForHost(host, template));
  }
  const wantIds = new Set(want.map((s) => s.id));

  const registered = await currentRegistrations();
  const registeredIds = new Set(registered.map((s) => s.id));

  const toRemove = registered.map((s) => s.id).filter((id) => !wantIds.has(id));
  const toAdd = want.filter((s) => !registeredIds.has(s.id));
  // Update covers the case where the template shape changed under an
  // existing host (a new content-script path, say).
  const toUpdate = want.filter((s) => registeredIds.has(s.id));

  // Each step on its own, so one failing does not leave the others undone.
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['unregister', () => (toRemove.length ? chrome.scripting.unregisterContentScripts({ ids: toRemove }) : Promise.resolve())],
    ['register', () => register(toAdd)],
    ['update', () => (toUpdate.length ? chrome.scripting.updateContentScripts(toUpdate) : Promise.resolve())]
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (err) {
      log.error(`content script reconcile (${name}) failed:`, err);
    }
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

/** One entry of sites.default.json, as the user wrote it. */
interface SeedEntry {
  host?: unknown;
  designerHost?: unknown;
}

/** A seed entry as a stored, ungranted host — or null when it has no valid host. */
function seededHost(entry: SeedEntry | null): HostEntry | null {
  const host = typeof entry?.host === 'string' ? normalizeHost(entry.host) : null;
  if (!host) return null;
  const seeded: HostEntry = { host, enabled: false, seeded: true };
  const designerHost = typeof entry?.designerHost === 'string' ? normalizeHost(entry.designerHost) : null;
  if (designerHost) seeded.designerHost = designerHost;
  return seeded;
}

export async function seedHostsIfEmpty(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(HOSTS_STORAGE_KEY);
    // Distinguish "never seeded" from "user deliberately emptied the list".
    if (stored[HOSTS_STORAGE_KEY]) return;

    const res = await fetch(chrome.runtime.getURL(SITES_SEED_FILE));
    if (!res.ok) return;
    const data = (await res.json()) as { hosts?: unknown } | null;
    if (!data || !Array.isArray(data.hosts)) return;

    const hosts = (data.hosts as Array<SeedEntry | null>)
      .map(seededHost)
      .filter((h): h is HostEntry => h !== null);
    if (!hosts.length) return;

    await writeHosts(hosts);
    log.warn(
      `seeded ${hosts.length} site(s) from ${SITES_SEED_FILE} — ` +
        'open the options page to grant them.'
    );
  } catch (err) {
    // No seed file, or it is malformed: start empty.
    log.debug('no site seed loaded:', err);
  }
}

// ---- the background's side --------------------------------------------------

/**
 * Keeps the registrations in step with the site list for the life of the
 * background: on install (after seeding), on browser start, and on every
 * change to the list. Reconciles are serialised and coalesced (see top).
 */
export class ContentScriptSync {
  private started = false;
  /** The pass running now (or the last one); the next waits for it. */
  private running: Promise<void> = Promise.resolve();
  /** A pass requested but not started yet: later requests join it. */
  private waiting: Promise<void> | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    chrome.runtime.onInstalled.addListener(this.onInstalled);
    chrome.runtime.onStartup.addListener(this.onStartup);
    chrome.storage.onChanged.addListener(this.onStorageChanged);
  }

  stop(): void {
    this.started = false;
    chrome.runtime.onInstalled.removeListener(this.onInstalled);
    chrome.runtime.onStartup.removeListener(this.onStartup);
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
  }

  /**
   * Reconcile once more after whatever pass is running. Never rejects.
   * Callers arriving before that pass starts share it.
   */
  reconcile(): Promise<void> {
    if (this.waiting) return this.waiting;
    const pass = this.running.then(async () => {
      this.waiting = null;
      try {
        await reconcileContentScripts();
      } catch (err) {
        log.error('content script reconcile failed:', err);
      }
    });
    this.waiting = pass;
    this.running = pass;
    return pass;
  }

  private readonly onInstalled = (): void => {
    void seedHostsIfEmpty().then(() => this.reconcile());
  };

  private readonly onStartup = (): void => {
    void this.reconcile();
  };

  private readonly onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (isHostsChange(changes, areaName)) void this.reconcile();
  };
}
