// All network endpoints the extension talks to.
//
// Every endpoint here is a path on the INSPECTED HOST — the Service Designer
// instance the user is already signed in to. The extension talks to no
// third-party service: method names, categories and designer URLs are read
// straight from the platform's own REST API, reusing the session the page
// already holds. See src/devtools/ad-api.js for the client.

/** AD chain URL detector — matches both fetch and execute variants. */
export const CHAIN_PATH_RE = /\/rest\/api\/automation\/chain\//i;

/** PD deployable-page config endpoint (relative to the inspected host). */
export const PD_DEPLOYABLE_PATH = '/rest/api/public/pagedesigner/deployable/pages';

/**
 * Chain definition fetch, V2 shape. `basicInfo=false` returns the full
 * document — `name` at the root, identity under `metadata`.
 */
export function chainV2Path(uuid) {
  return `/rest/api/automation/chain/v2/${encodeURIComponent(uuid)}?basicInfo=false`;
}

/**
 * Chain definition fetch, V1 shape. Fallback for instances whose platform
 * build predates the V2 endpoint.
 */
export function chainV1Path(uuid) {
  return `/rest/api/automation/chain/${encodeURIComponent(uuid)}`;
}

/** Automation Designer route for a method, given its category + draft uuid. */
export function designerPath(categoryName, draftUuid) {
  return `/automation-designer/${encodeURIComponent(categoryName)}/${draftUuid}`;
}

/**
 * URL parameter that carries a base64 request body from the AD Network
 * panel's "open in draft" action to the designer page, where the
 * curl-autofill content script consumes it and fills the method's inputs.
 * Produced and consumed entirely within this extension.
 */
export const AUTOFILL_PARAM = '_sdx_autofill';
