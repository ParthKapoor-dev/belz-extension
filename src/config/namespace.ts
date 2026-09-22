// String prefix for every DOM id, class, and data attribute the extension
// owns. Keeps them collision-free with the host app's CSS and lets you
// spot extension-injected DOM nodes at a glance (Inspect → filter on
// this prefix).

export const EXT_PREFIX = 'sdExtension';

/** Compose a namespaced identifier — `ns('SettingsButton')` → `'sdExtensionSettingsButton'`. */
export const ns = (name: string): string => EXT_PREFIX + name;

/** Marks DOM the extension injected, so its own features can skip it. */
export const EXTENSION_OWNED_ATTR = 'data-sd-extension-owned';
