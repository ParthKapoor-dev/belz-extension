// chrome.storage.local / chrome.storage.session keys. Every persisted piece
// of state lives under one of these — new keys added here so name collisions
// are easy to spot.

/** Feature toggles + textarea editor defaults. Written by src/core/settings.js. */
export const SETTINGS_STORAGE_KEY = 'sdExtensionSettingsV1';

/** User-added sites the extension is allowed to inject into. Options page + background. */
export const HOSTS_STORAGE_KEY = 'sdExtensionHostsV1';

/**
 * SWR cache of AD method metadata (uuid → name / category / state), keyed by
 * `<origin>|<uuid>`. Written by src/devtools/ad-cache.js. This is what keeps
 * the AD Network panel from re-resolving the same methods on every open.
 */
export const AD_CACHE_STORAGE_KEY = 'sdExtensionAdCacheV1';

/**
 * Focus-hint flag written by chrome.commands. Session-scoped (falls back to
 * local on browsers without session storage). DevTools panels react by
 * scrolling / pulsing / refetching when the flag targets them.
 */
export const FOCUS_STORAGE_KEY = 'sdExtensionPanelFocusV1';
