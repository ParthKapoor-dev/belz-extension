// Options page — user-editable list of hosts the extension acts on.
//
// Each host in the list is (a) an origin the user has granted us
// chrome.permissions on (host_permissions is dynamic at runtime in MV3), and
// (b) a set of registered content scripts the background worker reconciles
// against this same list. See src/background/content-scripts.ts for the reconcile loop.

import {
  isHostsChange,
  normalizeHost,
  originPattern,
  readHosts,
  writeHosts,
  type HostEntry
} from '../shared/hosts';
import { required } from '../shared/dom';

/** A stored host plus what the browser says about its permission right now. */
type HostWithGrant = HostEntry & { granted: boolean };

const listEl = required<HTMLUListElement>('#host-list');
const emptyEl = required('#empty');
const errorEl = required('#error');
const formEl = required<HTMLFormElement>('#add-form');
const inputEl = required<HTMLInputElement>('#add-input');
const addBtn = required<HTMLButtonElement>('#add-btn');

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function setError(msg: string): void {
  errorEl.textContent = msg || '';
}

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
        granted = await chrome.permissions.contains({
          origins: [originPattern(entry.host)]
        });
      } catch {
        granted = false;
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
    if (!match) continue;
    const shouldBe = match.granted;
    if (entry.enabled !== shouldBe) {
      entry.enabled = shouldBe;
      if (shouldBe) delete entry.seeded;
      changed = true;
    }
  }
  if (changed) await writeHosts(stored);
}

function render(hosts: HostWithGrant[]): void {
  listEl.replaceChildren();
  if (hosts.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
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

    main.append(hostEl, designerRow(entry));

    // A host we hold no permission for gets a Grant button — that is the only
    // way back, since permissions.request needs a user gesture.
    const btn = document.createElement('button');
    btn.type = 'button';
    if (entry.granted) {
      btn.className = 'revoke';
      btn.textContent = 'Revoke';
      btn.addEventListener('click', () => onRevoke(entry.host, btn));
    } else {
      btn.className = 'grant';
      btn.textContent = 'Grant';
      btn.addEventListener('click', () => onGrant(entry.host, btn));
    }

    li.append(main, btn);
    listEl.appendChild(li);
  }
}

/** Re-read storage, ask the browser for permission state, and repaint. */
async function refresh(): Promise<void> {
  const marked = await withGrantState(await readHosts());
  await syncEnabledFlags(marked);
  render(marked);
}

async function onGrant(host: string, button: HTMLButtonElement): Promise<void> {
  setError('');
  button.disabled = true;
  try {
    const granted = await chrome.permissions.request({
      origins: [originPattern(host)]
    });
    if (!granted) {
      setError(`Permission for ${host} was denied.`);
      return;
    }
    await refresh();
  } catch (err) {
    setError(errorText(err));
  } finally {
    button.disabled = false;
  }
}

// Optional per-site override: the host that actually serves the Automation
// Designer UI. Blank means "same host". Saved on blur / Enter rather than
// per-keystroke so we don't thrash storage (and the background reconciler,
// which listens on this same key).
function designerRow(entry: HostWithGrant): HTMLDivElement {
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

  async function commit(): Promise<void> {
    const raw = input.value.trim();
    const next = raw ? normalizeHost(raw) : '';
    if (raw && !next) {
      setError(`"${raw}" is not a valid hostname.`);
      return;
    }
    setError('');
    if ((entry.designerHost || '') === next) return;
    const hosts = await readHosts();
    const target = hosts.find((h) => h.host === entry.host);
    if (!target) return;
    if (next) target.designerHost = next;
    else delete target.designerHost;
    entry.designerHost = next || undefined;
    await writeHosts(hosts);
    saved.classList.add('show');
    setTimeout(() => saved.classList.remove('show'), 1200);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  });

  row.append(label, input, saved);
  return row;
}

async function onAdd(host: string): Promise<void> {
  setError('');
  addBtn.disabled = true;
  try {
    // chrome.permissions.request must run inside a user-gesture handler —
    // the submit event chain is one, provided we don't await anything else
    // first. This branch runs synchronously off the click.
    const granted = await chrome.permissions.request({ origins: [originPattern(host)] });
    if (!granted) {
      setError(`Permission for ${host} was denied.`);
      return;
    }
    const hosts = await readHosts();
    const existing = hosts.find((h) => h.host === host);
    if (existing) {
      // Already listed — typically a seeded entry the user just re-granted.
      // Mark it live rather than refusing the add.
      existing.enabled = true;
      delete existing.seeded;
    } else {
      hosts.push({ host, enabled: true, addedAt: Date.now() });
    }
    await writeHosts(hosts);
    inputEl.value = '';
    await refresh();
  } catch (err) {
    setError(errorText(err));
  } finally {
    addBtn.disabled = false;
    inputEl.focus();
  }
}

async function onRevoke(host: string, button: HTMLButtonElement): Promise<void> {
  setError('');
  button.disabled = true;
  try {
    // Remove the permission first — if the user cancels this we don't want
    // to leak the host from storage while the browser still trusts it.
    const removed = await chrome.permissions.remove({
      origins: [originPattern(host)]
    });
    if (!removed) {
      setError(`Could not revoke ${host}.`);
      return;
    }
    const hosts = (await readHosts()).filter((h) => h.host !== host);
    await writeHosts(hosts);
    await refresh();
  } catch (err) {
    setError(errorText(err));
  } finally {
    button.disabled = false;
  }
}

formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const host = normalizeHost(inputEl.value);
  if (!host) {
    setError('Enter a valid hostname (e.g. nsm-dev.nc.verifi.dev).');
    return;
  }
  onAdd(host);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (isHostsChange(changes, areaName)) refresh();
});

// Permissions also change outside this page — the browser's own add-on settings
// can revoke a host while we are open. Without these listeners the list would
// keep offering Revoke for a host we no longer hold.
if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(() => refresh());
}
if (chrome.permissions && chrome.permissions.onRemoved) {
  chrome.permissions.onRemoved.addListener(() => refresh());
}

refresh();
