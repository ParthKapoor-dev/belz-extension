// Options page — user-editable list of hosts the extension acts on.
//
// Each host in the list is (a) an origin the user has granted us
// chrome.permissions on (host_permissions is dynamic at runtime in MV3), and
// (b) a set of registered content scripts the background worker reconciles
// against this same list. See src/background.js for the reconcile loop.

import { HOSTS_STORAGE_KEY } from './config/storage-keys.js';

const listEl = document.getElementById('host-list');
const emptyEl = document.getElementById('empty');
const errorEl = document.getElementById('error');
const formEl = document.getElementById('add-form');
const inputEl = document.getElementById('add-input');
const addBtn = document.getElementById('add-btn');

// A bare-host input: letters/digits/dashes/dots, optionally scheme-prefixed.
// We strip scheme, path, port, whitespace before validating.
function normalizeHost(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  const withoutScheme = raw.replace(/^https?:\/\//i, '');
  const noPath = withoutScheme.replace(/[/?#].*$/, '');
  const noPort = noPath.replace(/:.*$/, '');
  const host = noPort.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) {
    return null;
  }
  return host;
}

async function readHosts() {
  const result = await chrome.storage.local.get(HOSTS_STORAGE_KEY);
  const raw = result && result[HOSTS_STORAGE_KEY];
  if (!raw || !Array.isArray(raw.hosts)) return [];
  return raw.hosts.filter((h) => h && typeof h.host === 'string');
}

async function writeHosts(hosts) {
  await chrome.storage.local.set({ [HOSTS_STORAGE_KEY]: { hosts } });
}

function setError(msg) {
  errorEl.textContent = msg || '';
}

function render(hosts) {
  listEl.replaceChildren();
  if (hosts.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  for (const entry of hosts) {
    const li = document.createElement('li');
    const hostEl = document.createElement('div');
    hostEl.className = 'host';
    hostEl.textContent = entry.host;
    const revokeBtn = document.createElement('button');
    revokeBtn.className = 'revoke';
    revokeBtn.type = 'button';
    revokeBtn.textContent = 'Revoke';
    revokeBtn.addEventListener('click', () => onRevoke(entry.host, revokeBtn));
    li.append(hostEl, revokeBtn);
    listEl.appendChild(li);
  }
}

async function onAdd(host) {
  setError('');
  addBtn.disabled = true;
  try {
    // chrome.permissions.request must run inside a user-gesture handler —
    // the submit event chain is one, provided we don't await anything else
    // first. This branch runs synchronously off the click.
    const origin = `https://${host}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      setError(`Permission for ${host} was denied.`);
      return;
    }
    const hosts = await readHosts();
    if (hosts.some((h) => h.host === host)) {
      setError(`${host} is already in the list.`);
      return;
    }
    hosts.push({ host, enabled: true, addedAt: Date.now() });
    await writeHosts(hosts);
    inputEl.value = '';
    render(hosts);
  } catch (err) {
    setError(String((err && err.message) || err));
  } finally {
    addBtn.disabled = false;
    inputEl.focus();
  }
}

async function onRevoke(host, button) {
  setError('');
  button.disabled = true;
  try {
    // Remove the permission first — if the user cancels this we don't want
    // to leak the host from storage while the browser still trusts it.
    const removed = await chrome.permissions.remove({
      origins: [`https://${host}/*`]
    });
    if (!removed) {
      setError(`Could not revoke ${host}.`);
      return;
    }
    const hosts = (await readHosts()).filter((h) => h.host !== host);
    await writeHosts(hosts);
    render(hosts);
  } catch (err) {
    setError(String((err && err.message) || err));
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
  if (areaName !== 'local' || !changes[HOSTS_STORAGE_KEY]) return;
  readHosts().then(render);
});

readHosts().then(render);
