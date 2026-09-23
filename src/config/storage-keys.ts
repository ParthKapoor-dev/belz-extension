// chrome.storage.local / chrome.storage.session keys. Every persisted piece
// of state lives under one of these — new keys added here so name collisions
// are easy to spot.
//
// The `sdExtension…V1` keys do not carry the extension's `belz` prefix (see
// namespace.ts) and keep their names: renaming a key loses what every user
// has stored under it. The same goes for the shape stored under a key: an
// incompatible change needs a new key or a migration (config/README.md,
// "Stored shapes").

/** Feature toggles + IDE defaults. Written by src/designer/core/settings.ts. */
export const SETTINGS_STORAGE_KEY = 'sdExtensionSettingsV1';

/** User-added sites the extension is allowed to inject into. Options page + background. */
export const HOSTS_STORAGE_KEY = 'sdExtensionHostsV1';

/**
 * SWR cache of AD method metadata (uuid → name / category / state), keyed by
 * `<origin>|<uuid>`. Written by src/devtools/ad-network/cache.ts. This is what keeps
 * the AD Network panel from re-resolving the same methods on every open.
 */
export const AD_CACHE_STORAGE_KEY = 'sdExtensionAdCacheV1';

/**
 * Focus-hint flag written by chrome.commands, in session storage. DevTools
 * panels react by scrolling / pulsing / refetching when the flag targets them.
 */
export const FOCUS_STORAGE_KEY = 'sdExtensionPanelFocusV1';

/**
 * Prefix of an "Open in draft" handoff: the request body the AD Network panel
 * leaves for the designer tab it opens, under `<prefix><random id>`. Session
 * storage, read once, short-lived: see src/shared/autofill-handoff.ts.
 */
export const AUTOFILL_HANDOFF_KEY_PREFIX = 'belzAutofillHandoff:';
