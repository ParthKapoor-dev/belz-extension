// All network endpoints the extension talks to.
//
// Every endpoint here is a path on the INSPECTED HOST — the Service Designer
// instance the user is already signed in to. The extension talks to no
// third-party service: method names, categories and designer URLs are read
// straight from the platform's own REST API, reusing the session the page
// already holds. See src/devtools/ad-network/api.ts for the client.

import { AD_ROUTE_PREFIX, PD_ROUTE_PREFIX } from './routes';

/** AD chain URL detector — matches both fetch and execute variants. */
export const CHAIN_PATH_RE = /\/rest\/api\/automation\/chain\//i;

/** PD deployable-page config endpoint (relative to the inspected host). */
export const PD_DEPLOYABLE_PATH = '/rest/api/public/pagedesigner/deployable/pages';

/**
 * Chain definition fetch, V2 shape. `basicInfo=false` returns the full
 * document — `name` at the root, identity under `metadata`.
 */
export function chainV2Path(uuid: string): string {
  return `/rest/api/automation/chain/v2/${encodeURIComponent(uuid)}?basicInfo=false`;
}

/**
 * Chain definition fetch, V1 shape. Fallback for instances whose platform
 * build predates the V2 endpoint.
 */
export function chainV1Path(uuid: string): string {
  return `/rest/api/automation/chain/${encodeURIComponent(uuid)}`;
}

/** Automation Designer route for a method, given its category + draft uuid. */
export function designerPath(categoryName: string, draftUuid: string): string {
  return `${AD_ROUTE_PREFIX}${encodeURIComponent(categoryName)}/${draftUuid}`;
}

/** Page Designer route for a page, by its reference page id. */
export function pdPagePath(referencePageId: string): string {
  return `${PD_ROUTE_PREFIX}page/${referencePageId}`;
}

/** Page Designer route for a component (symbol), by name. */
export function pdSymbolPath(name: string): string {
  return `${PD_ROUTE_PREFIX}symbol/${encodeURIComponent(name)}`;
}

/**
 * URL parameter that carries a base64 request body from the AD Network
 * panel's "open in draft" action to the designer page, where the
 * curl-autofill content script consumes it and fills the method's inputs.
 * Produced and consumed entirely within this extension.
 */
export const AUTOFILL_PARAM = '_sdx_autofill';
