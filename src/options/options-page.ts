// The options page: the user-editable list of hosts the extension acts on.
//
// Each host in the list is (a) an origin the user has granted us
// chrome.permissions on (host permissions are requested at runtime in MV3),
// and (b) a set of registered content scripts the background worker
// reconciles against this same list. This page only writes the list; see
// src/background/content-scripts.ts for the reconcile loop.

import {
  hostPattern,
  isHostsChange,
  normalizeHost,
  readHosts,
  writeHosts,
  type HostEntry
} from '../shared/hosts';
import { required } from '../shared/dom';
import { errorText } from '../shared/errors';
import { createLogger } from '../shared/logger';

const log = createLogger('options');

/** How long the "saved" hint stays next to a committed designer host. */
const SAVED_HINT_MS = 1200;

/** A stored host plus what the browser says about its permission right now. */
type HostWithGrant = HostEntry & { granted: boolean };

/**
 * The browser — not storage — is the authority on whether we hold a host
 * permission. A list restored from sites.default.json, or one surviving a
 * profile change, can name hosts we no longer have access to, so every render
 * asks chrome.permissions rather than trusting the stored `enabled` flag.
 */
async function withGrantState(hosts: HostEntry[]): Promise<HostWithGrant[]> {
  return Promise.all(
    hosts.map(async (entry) => {
      let granted = false;
      try {
        granted = await chrome.permissions.contains({ origins: [hostPattern(entry.host)] });
      } catch (err) {
        log.debug(`cannot check the permission for ${entry.host}:`, err);
      }
      return { ...entry, granted };
    })
  );
}

/** Reconcile the stored enabled flag with what the browser actually reports. */
async function syncEnabledFlags(marked: HostWithGrant[]): Promise<void> {
  const stored = await readHosts();
  let changed = false;
  for (const entry of stored) {
    const match = marked.find((m) => m.host === entry.host);
    if (!match || entry.enabled === match.granted) continue;
    entry.enabled = match.granted;
    if (match.granted) delete entry.seeded;
    changed = true;
  }
  if (changed) await writeHosts(stored);
}

/**
 * The Allowed sites list over options.html's markup. start() wires the form
 * and the storage/permission listeners and paints; stop() removes them all.
 */
export class OptionsPage {
  /** The page's elements: read by start(), not before. */
  private listEl!: HTMLUListElement;
  private emptyEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private formEl!: HTMLFormElement;
  private inputEl!: HTMLInputElement;
  private addBtn!: HTMLButtonElement;

  private started = false;
  /** Bumped per refresh and by stop(), so a slower, older refresh never paints. */
  private generation = 0;
  /** Pending "saved" hint timers, cleared by stop(). */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.listEl = required<HTMLUListElement>('#host-list');
    this.emptyEl = required('#empty');
    this.errorEl = required('#error');
    this.formEl = required<HTMLFormElement>('#add-form');
    this.inputEl = required<HTMLInputElement>('#add-input');
    this.addBtn = required<HTMLButtonElement>('#add-btn');
    this.formEl.addEventListener('submit', this.onSubmit);
    chrome.storage.onChanged.addListener(this.onStorageChanged);
    // Permissions also change outside this page — the browser's own add-on
    // settings can revoke a host while we are open. Without these listeners
    // the list would keep offering Revoke for a host we no longer hold.
    chrome.permissions?.onAdded?.addListener(this.onPermissionsChanged);
    chrome.permissions?.onRemoved?.addListener(this.onPermissionsChanged);
    void this.refresh();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.generation++;
    this.formEl.removeEventListener('submit', this.onSubmit);
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
    chrome.permissions?.onAdded?.removeListener(this.onPermissionsChanged);
    chrome.permissions?.onRemoved?.removeListener(this.onPermissionsChanged);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Re-read storage, ask the browser for permission state, and repaint. */
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const marked = await withGrantState(await readHosts());
    if (generation !== this.generation) return;
    await syncEnabledFlags(marked);
    if (generation !== this.generation) return;
    this.render(marked);
  }

  // ---- handlers ------------------------------------------------------------

  private readonly onSubmit = (e: Event): void => {
    e.preventDefault();
    const host = normalizeHost(this.inputEl.value);
    if (!host) {
      this.setError('Enter a valid hostname (e.g. your-instance.example.com).');
      return;
    }
    void this.add(host);
  };

  private readonly onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (isHostsChange(changes, areaName)) void this.refresh();
  };

  private readonly onPermissionsChanged = (): void => {
    void this.refresh();
  };

  // ---- actions -------------------------------------------------------------

  /** Show `msg` under the list (and log it); '' clears it. */
  private setError(msg: string): void {
    this.errorEl.textContent = msg;
    if (msg) log.warn(msg);
  }

  private async add(host: string): Promise<void> {
    this.setError('');
    this.addBtn.disabled = true;
    try {
      // chrome.permissions.request must run inside a user-gesture handler —
      // the submit event chain is one, provided nothing else is awaited first.
      const granted = await chrome.permissions.request({ origins: [hostPattern(host)] });
      if (!granted) {
        this.setError(`Permission for ${host} was denied.`);
        return;
      }
      const hosts = await readHosts();
      const existing = hosts.find((h) => h.host === host);
      if (existing) {
        // Already listed — typically a seeded entry the user just granted.
        // Mark it live rather than refusing the add.
        existing.enabled = true;
        delete existing.seeded;
      } else {
        hosts.push({ host, enabled: true, addedAt: Date.now() });
      }
      await writeHosts(hosts);
      this.inputEl.value = '';
      await this.refresh();
    } catch (err) {
      this.setError(errorText(err));
    } finally {
      this.addBtn.disabled = false;
      this.inputEl.focus();
    }
  }

  private async grant(host: string, button: HTMLButtonElement): Promise<void> {
    this.setError('');
    button.disabled = true;
    try {
      const granted = await chrome.permissions.request({ origins: [hostPattern(host)] });
      if (!granted) {
        this.setError(`Permission for ${host} was denied.`);
        return;
      }
      await this.refresh();
    } catch (err) {
      this.setError(errorText(err));
    } finally {
      button.disabled = false;
    }
  }

  /**
   * Revoke: remove the permission first, then drop the entry from storage.
   * The background sees that storage change and unregisters the host's
   * content scripts. If the browser refuses the removal, the entry stays, so
   * the list never hides a host the browser still trusts.
   */
  private async revoke(host: string, button: HTMLButtonElement): Promise<void> {
    this.setError('');
    button.disabled = true;
    try {
      const removed = await chrome.permissions.remove({ origins: [hostPattern(host)] });
      if (!removed) {
        this.setError(`Could not revoke ${host}.`);
        return;
      }
      await writeHosts((await readHosts()).filter((h) => h.host !== host));
      await this.refresh();
    } catch (err) {
      this.setError(errorText(err));
    } finally {
      button.disabled = false;
    }
  }

  /**
   * Save a host's designer-host override. Blank means "same host". Called on
   * blur / Enter rather than per keystroke, so storage (and the background
   * reconciler listening on the same key) is not thrashed.
   */
  private async commitDesignerHost(entry: HostWithGrant, input: HTMLInputElement, saved: HTMLElement): Promise<void> {
    const raw = input.value.trim();
    const next = raw ? normalizeHost(raw) : '';
    if (raw && !next) {
      this.setError(`"${raw}" is not a valid hostname.`);
      return;
    }
    this.setError('');
    if ((entry.designerHost || '') === next) return;
    const hosts = await readHosts();
    const target = hosts.find((h) => h.host === entry.host);
    if (!target) return;
    if (next) target.designerHost = next;
    else delete target.designerHost;
    entry.designerHost = next || undefined;
    await writeHosts(hosts);
    if (!this.started) return;
    saved.classList.add('show');
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      saved.classList.remove('show');
    }, SAVED_HINT_MS);
    this.timers.add(timer);
  }

  // ---- rendering -----------------------------------------------------------

  private render(hosts: HostWithGrant[]): void {
    this.listEl.replaceChildren();
    this.emptyEl.style.display = hosts.length === 0 ? 'block' : 'none';
    for (const entry of hosts) {
      const li = document.createElement('li');

      const main = document.createElement('div');
      main.className = 'host-main';

      const hostEl = document.createElement('div');
      hostEl.className = 'host';
      hostEl.textContent = entry.host;
      if (!entry.granted) {
        const badge = document.createElement('span');
        badge.className = 'needs-grant';
        badge.textContent = 'not granted';
        hostEl.appendChild(badge);
      }
      main.append(hostEl, this.designerRow(entry));

      // A host we hold no permission for gets a Grant button — that is the
      // only way back, since permissions.request needs a user gesture.
      const btn = document.createElement('button');
      btn.type = 'button';
      if (entry.granted) {
        btn.className = 'revoke';
        btn.textContent = 'Revoke';
        btn.addEventListener('click', () => void this.revoke(entry.host, btn));
      } else {
        btn.className = 'grant';
        btn.textContent = 'Grant';
        btn.addEventListener('click', () => void this.grant(entry.host, btn));
      }

      li.append(main, btn);
      this.listEl.appendChild(li);
    }
  }

  /** The optional per-site designer host: the host that serves the AD UI. */
  private designerRow(entry: HostWithGrant): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'designer-row';

    const label = document.createElement('label');
    label.textContent = 'designer host';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = entry.designerHost || '';
    input.placeholder = entry.host;
    input.autocomplete = 'off';
    input.spellcheck = false;

    const saved = document.createElement('span');
    saved.className = 'saved';
    saved.textContent = 'saved';

    input.addEventListener('blur', () => void this.commitDesignerHost(entry, input, saved));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });

    row.append(label, input, saved);
    return row;
  }
}
