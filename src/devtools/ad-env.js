// Env resolution for the AD Network panel.
//
// The belz CLI config is the source of truth for which envs exist and which
// host each one lives on, so we fetch that map from belz web on init. This is
// what makes the panel work for ANY project the user has configured (NSM,
// YieldSec, …) instead of only NSM. The regex fallbacks below cover the
// moment before the registry loads / when belz web is unreachable.

import { BELZ_WEB_ENVS } from '../config/endpoints.js';

/** lowercase hostname → belz env name (project-agnostic registry). */
const envByHost = new Map();

let currentEnv = 'nsm-dev';

export function getCurrentEnv() {
  return currentEnv;
}

/**
 * Maps the inspected window's hostname to a belz env name. Public-portal hosts
 * collapse to the same env as their staff portal — the AD method behind them
 * is the same entity, and the designer only lives on the staff portal.
 */
export function envFromHost(host) {
  if (typeof host !== 'string') return currentEnv || 'nsm-dev';
  const h = host.toLowerCase();

  // 1. Exact match against the configured envs (project-agnostic).
  const fromRegistry = envByHost.get(h);
  if (fromRegistry) return fromRegistry;

  // 2. Built-in fallbacks for before the registry loads / belz web is down.
  const nsm = h.match(/^(nsm-(?:dev|qa|uat))(?:-public)?\./);
  if (nsm) return nsm[1];
  if (h === 'staff-nss-stage.verifi-nc.com') return 'nsm-stage';
  if (h === 'staff-nss.verifi-nc.com') return 'nsm-prod';
  if (h === 'yieldsec.expertly.cloud') return 'ys-demo';
  if (h === 'yieldsec.qa.expertly.cloud') return 'ys-qa';
  if (h === 'yieldsec.stage.expertly.cloud') return 'ys-stage';
  if (h === 'yieldsec.expertly.com') return 'ys-prod';
  return currentEnv || 'nsm-dev';
}

/**
 * AD/PD designer routes live ONLY on staff portals — the public portal serves
 * the operator app, not the designer. For NSM the public host is the staff
 * host with a `-public` modifier, so strip it; for other projects belz web
 * already returns the configured staff URL, so this is a no-op there.
 */
export function toStaffPortalUrl(url) {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.replace(/^(nsm-(?:dev|qa|uat))-public\./i, '$1.');
    return u.toString();
  } catch {
    return url;
  }
}

/** Read the inspected window's hostname and cache the resolved env. */
export function detectEnv() {
  try {
    chrome.devtools.inspectedWindow.eval('location.hostname', (result) => {
      currentEnv = envFromHost(result);
    });
  } catch {
    /* keep previous env */
  }
}

/**
 * Fetch the belz env registry and populate the host→env map. Non-fatal if
 * belz web is unreachable — falls back to the built-in host rules above.
 *
 * @param {(offline: boolean) => void} onOffline
 */
export function loadEnvRegistry(onOffline) {
  fetch(BELZ_WEB_ENVS)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !Array.isArray(data.envs)) return;
      envByHost.clear();
      for (const e of data.envs) {
        if (e && typeof e.host === 'string' && e.host && typeof e.name === 'string') {
          envByHost.set(e.host.toLowerCase(), e.name);
        }
      }
      if (typeof onOffline === 'function') onOffline(false);
      detectEnv();
    })
    .catch(() => {
      /* belz web down — fallback host rules take over */
    });
}
