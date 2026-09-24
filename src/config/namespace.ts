// The extension's one naming prefix, `belz`, for every name it adds to a
// world it shares with someone else: DOM ids, classes and data attributes on
// the designer pages, globals in the inspected page, message keys, and the
// autofill marker in a designer URL. One prefix keeps them collision-free with
// the host app and easy to spot (Inspect → filter on "belz").
//
// The one exception is the storage keys in storage-keys.ts: they keep their
// `sdExtension…V1` names, whose `V1` is the version of the shape stored under
// them (config/README.md, "Stored shapes").

export const EXT_PREFIX = 'belz';

/** Compose a namespaced identifier — `ns('SettingsButton')` → `'belzSettingsButton'`. */
export const ns = <N extends string>(name: N): `belz${N}` => `${EXT_PREFIX}${name}` as `belz${N}`;

/** Compose a namespaced data attribute — `nsAttr('owned')` → `'data-belz-owned'`. */
export function nsAttr(name: string): string {
  return `data-${EXT_PREFIX}-${name}`;
}

/**
 * Compose a namespaced global or message key — `nsGlobal('Command')` →
 * `'__belzCommand'`. The leading underscores mark it as not the page's own.
 */
export const nsGlobal = <N extends string>(name: N): `__belz${N}` =>
  `__${EXT_PREFIX}${name}` as `__belz${N}`;

/** Marks DOM the extension injected, so its own features can skip it. */
export const EXTENSION_OWNED_ATTR = nsAttr('owned');

/**
 * Globals the AD Network panel's fetch/XHR wrapper (devtools/ad-network/
 * pending-capture.ts) keeps in the inspected page.
 */
export const PAGE_GLOBALS = {
  /**
   * The wrapper's state: the page's original fetch/XHR, whether it is
   * active, and its map of in-flight chain requests.
   */
  capture: nsGlobal('ADCapture')
} as const;

/** Key of a browser-command message from the background to a designer page. */
export const COMMAND_MESSAGE_KEY = nsGlobal('Command');

/** Key of an allowed-sites edit from the options page to the background. */
export const HOSTS_MESSAGE_KEY = nsGlobal('Hosts');

/** Key of an autofill-handoff message from a designer page to the background. */
export const AUTOFILL_MESSAGE_KEY = nsGlobal('Autofill');

/**
 * The URL-fragment parameter that carries an "Open in draft" handoff id from
 * the AD Network panel to the designer page: `#belz-autofill=<id>`.
 */
export const AUTOFILL_FRAGMENT_PARAM = `${EXT_PREFIX}-autofill`;
