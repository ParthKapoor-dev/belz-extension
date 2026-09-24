// The allowed-sites list's one owner, and the content scripts registered for it.
//
// The manifest declares no content scripts: which sites the extension runs on
// is the user's choice, made on the options page. ContentScriptSync makes the
// registered scripts match the list — three per granted host (AD, PD, PD
// Inspector) with stable ids.
//
// Only the background writes the list, and one change at a time. The options
// page asks for each change with a HostsEdit message (add a granted host,
// drop a revoked one, set a designer host); a host's `enabled` flag follows
// the browser's permission, which can also change outside the options page
// (the browser's own extension settings), so on startup, on install (after
// seeding) and on every permission change the flags are synced with the
// browser (syncGrants). All of these run in one queue, so no two of them
// read-modify-write the list at once.
//
// Reconciles run in that queue too. They are triggered by every storage
// change to the list, and explicitly after a grant sync or an edit (a sync
// that changed nothing writes nothing, and a browser start still has to
// restore the registrations). Two reconciles at once would both see a script
// missing and both register it, and the second would fail with "Duplicate
// script ID". Requests that arrive while one waits are coalesced into it; it
// reads the list when it starts, so the latest list wins.

import { HOSTS_STORAGE_KEY } from '../config/storage-keys';
import { AD_ROUTE_PREFIX, PD_ROUTE_PREFIX, PAGES_ROUTE_PREFIX } from '../config/routes';
import { CONTENT_SCRIPT_FILES, SITES_SEED_FILE } from '../config/extension-files';
import {
  hostPattern,
  isGranted,
  isHostsChange,
  normalizeHost,
  readEnabledHosts,
  readGrants,
  readHosts,
  writeHosts,
  type HostEntry
} from '../shared/hosts';
import { errorText } from '../shared/errors';
import { createLogger } from '../shared/logger';
import { isFromOptionsPage, isHostsEdit, type HostsEdit, type HostsEditResult } from '../shared/messages';
import { HOSTS_MESSAGE_KEY } from '../config/namespace';

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

// ---- the list's changes ---------------------------------------------------------

/**
 * Store each host's `enabled` flag as the browser reports its permission. A
 * granted seeded entry also loses its `seeded` mark.
 */
async function syncEnabledFlags(): Promise<void> {
  const stored = await readHosts();
  const grants = await readGrants(stored);
  let changed = false;
  for (const entry of stored) {
    const granted = grants.get(entry.host)!;
    if (entry.enabled === granted) continue;
    entry.enabled = granted;
    if (granted) delete entry.seeded;
    changed = true;
  }
  if (changed) await writeHosts(stored);
}

/**
 * Make one options-page change to the list, in place, so the order stays.
 * Rejects with the reason it was refused: a host that is not a normalised
 * hostname, an add the browser did not grant, a revoke of a permission the
 * browser still holds. An edit of a host that is not listed changes nothing.
 */
async function applyHostsEdit(edit: HostsEdit): Promise<void> {
  const host = edit.host;
  if (normalizeHost(host) !== host) throw new Error(`"${host}" is not a valid hostname.`);
  const op = edit[HOSTS_MESSAGE_KEY];
  // The browser is the authority on grants: the list never names a host as
  // granted that is not, nor drops one the browser still trusts.
  if (op === 'add' && !(await isGranted(host))) throw new Error(`Permission for ${host} was not granted.`);
  if (op === 'revoke' && (await isGranted(host))) throw new Error(`Could not revoke ${host}.`);

  const hosts = await readHosts();
  const index = hosts.findIndex((h) => h.host === host);
  const entry = hosts[index];
  if (op === 'add') {
    if (entry) {
      // Already listed: typically a seeded entry the user just granted.
      entry.enabled = true;
      delete entry.seeded;
    } else {
      hosts.push({ host, enabled: true, addedAt: Date.now() });
    }
  } else if (!entry) {
    return;
  } else if (op === 'revoke') {
    hosts.splice(index, 1);
  } else {
    const designerHost = edit.designerHost ? normalizeHost(edit.designerHost) : '';
    if (designerHost === null) throw new Error(`"${edit.designerHost}" is not a valid hostname.`);
    if (designerHost) entry.designerHost = designerHost;
    else delete entry.designerHost;
  }
  await writeHosts(hosts);
}

// ---- the background's side --------------------------------------------------

/**
 * Owns the site list and keeps the registrations in step with it, for the
 * life of the background: the options page's edits, grant syncs (on install
 * after seeding, on browser start, on every permission change) and
 * reconciles (on every change to the list) all run one at a time, in one
 * queue; reconciles are coalesced (see top).
 */
export class ContentScriptSync {
  private started = false;
  /** The task running now (or the last one); the next waits for it. */
  private running: Promise<unknown> = Promise.resolve();
  /** A reconcile requested but not started yet: later requests join it. */
  private waiting: Promise<void> | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    chrome.runtime.onInstalled.addListener(this.onInstalled);
    chrome.runtime.onStartup.addListener(this.onStartup);
    chrome.runtime.onMessage.addListener(this.onMessage);
    chrome.storage.onChanged.addListener(this.onStorageChanged);
    chrome.permissions.onAdded.addListener(this.onPermissionsChanged);
    chrome.permissions.onRemoved.addListener(this.onPermissionsChanged);
  }

  stop(): void {
    this.started = false;
    chrome.runtime.onInstalled.removeListener(this.onInstalled);
    chrome.runtime.onStartup.removeListener(this.onStartup);
    chrome.runtime.onMessage.removeListener(this.onMessage);
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
    chrome.permissions.onAdded.removeListener(this.onPermissionsChanged);
    chrome.permissions.onRemoved.removeListener(this.onPermissionsChanged);
  }

  /** Run `task` after everything queued before it. Settles as `task` does. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.running.then(task);
    this.running = run.catch(() => undefined);
    return run;
  }

  /**
   * Reconcile once more after whatever is running. Never rejects. Callers
   * arriving before that pass starts share it.
   */
  reconcile(): Promise<void> {
    if (this.waiting) return this.waiting;
    const pass = this.enqueue(async () => {
      this.waiting = null;
      try {
        await reconcileContentScripts();
      } catch (err) {
        log.error('content script reconcile failed:', err);
      }
    });
    this.waiting = pass;
    return pass;
  }

  /**
   * Store each host's `enabled` flag as the browser reports its permission,
   * after whatever is running, then reconcile. Never rejects.
   */
  syncGrants(): Promise<void> {
    const sync = this.enqueue(async () => {
      try {
        await syncEnabledFlags();
      } catch (err) {
        log.error('syncing the site permissions failed:', err);
      }
    });
    return sync.then(() => this.reconcile());
  }

  /**
   * Make one options-page change to the list, after whatever is running,
   * then reconcile. Resolves with what to answer the page; never rejects.
   */
  async edit(edit: HostsEdit): Promise<HostsEditResult> {
    try {
      await this.enqueue(() => applyHostsEdit(edit));
    } catch (err) {
      return { ok: false, error: errorText(err) || 'The site list could not be changed.' };
    }
    void this.reconcile();
    return { ok: true };
  }

  /** Answers HostsEdit messages from the options page; returns true when it will. */
  readonly onMessage = (
    msg: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: HostsEditResult) => void
  ): boolean => {
    if (!isHostsEdit(msg) || !isFromOptionsPage(sender)) return false;
    void this.edit(msg).then(sendResponse);
    return true;
  };

  private readonly onInstalled = (): void => {
    void this.enqueue(seedHostsIfEmpty).then(() => this.syncGrants());
  };

  private readonly onStartup = (): void => {
    void this.syncGrants();
  };

  private readonly onPermissionsChanged = (): void => {
    void this.syncGrants();
  };

  private readonly onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (isHostsChange(changes, areaName)) void this.reconcile();
  };
}
