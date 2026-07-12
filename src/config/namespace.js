// String prefix for every DOM id, class, and data attribute the extension
// owns. Keeps them collision-free with the host app's CSS and lets you
// spot extension-injected DOM nodes at a glance (Inspect → filter on
// this prefix).

export const EXT_PREFIX = 'sdExtension';

/** Compose a namespaced identifier — `ns('SettingsButton')` → `'sdExtensionSettingsButton'`. */
export const ns = (name) => EXT_PREFIX + name;
