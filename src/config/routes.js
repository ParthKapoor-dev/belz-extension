// Path prefixes the extension acts on. Grouped here so a change to the host
// app's route shape lands in one place rather than five inline literals.

/** Automation Designer route — content script + curl-autofill + shortcuts. */
export const AD_ROUTE_PREFIX = '/automation-designer/';

/** Page Designer route — content script + title updater. */
export const PD_ROUTE_PREFIX = '/ui-designer/';

/** Published-page route — PD inspector engine. */
export const PAGES_ROUTE_PREFIX = '/pages/';
