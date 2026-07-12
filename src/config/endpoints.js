// All network endpoints the extension talks to.
//
// Two classes of endpoints:
//
//   1. Page-relative paths on the inspected host — the AD chain URL that
//      the DevTools panel filters on, and the PD deployable-page config.
//      The extension never picks the host; it uses whatever host the user
//      is on. So we only need path prefixes here.
//
//   2. belz web (localhost) — the user's belz CLI's locally-running web
//      app, used by the DevTools panel to resolve UUIDs → method names and
//      draft URLs. Fixed origin.

/** AD chain URL detector — matches both fetch and execute variants. */
export const CHAIN_PATH_RE = /\/rest\/api\/automation\/chain\//i;

/** PD deployable-page config endpoint (relative to the inspected host). */
export const PD_DEPLOYABLE_PATH = '/rest/api/public/pagedesigner/deployable/pages';

/** belz web origin — the CLI's locally-hosted API. */
export const BELZ_WEB_ORIGIN = 'http://localhost:65535';

/** Env registry (belz CLI's configured environments). */
export const BELZ_WEB_ENVS = BELZ_WEB_ORIGIN + '/api/envs';

/** UUID → { name, category, editUrl } resolver. */
export const BELZ_WEB_RESOLVE = BELZ_WEB_ORIGIN + '/api/resolve';

/** Batch UUID → name resolver — reduces a burst of resolves to one request. */
export const BELZ_WEB_AD_NAMES = BELZ_WEB_ORIGIN + '/api/ad-names';

/**
 * URL parameter that tells the belz-served draft page to autofill inputs
 * from a cURL command. Consumed by the curl-autofill content script and
 * produced by the "Open in draft" action in the AD Network panel.
 */
export const BELZ_AUTOFILL_PARAM = '_belz_autofill';
