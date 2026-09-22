/*! belz-singleton: designer/core/settings */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
import { SETTINGS_STORAGE_KEY } from '../../config/storage-keys.js';

export const TEXTAREA_EDITOR_WRAP_OPTIONS = ['nowrap', 'wrap'];
export const TEXTAREA_EDITOR_FONT_SIZE_OPTIONS = [12, 13, 14, 16, 18];

export const DEFAULT_SETTINGS = {
  titleUpdater: true,
  runTestShortcut: true,
  jsonEditor: true,
  outputCopy: true,
  textareaEditor: true,
  textareaEditorWrap: 'wrap',
  textareaEditorFontSize: 13
};

export const FEATURE_SETTING_DEFINITIONS = [
  {
    key: 'titleUpdater',
    label: 'Title Updater',
    description: 'Update tab title with AD/PD method/page name'
  },
  {
    key: 'runTestShortcut',
    label: 'Keyboard Shortcuts',
    description: 'Ctrl+Shift+Enter run test · Shift+L copy link · Esc Esc unfocus'
  },
  {
    key: 'jsonEditor',
    label: 'JSON Editor',
    description: 'Show JSON input button and modal editor'
  },
  {
    key: 'outputCopy',
    label: 'Output Copy',
    description: 'Show Copy button near output containers'
  },
  {
    key: 'textareaEditor',
    label: 'Textarea Editor',
    description: 'Show Open button for native textareas'
  }
];

// The editor language is not listed here: it is always detected from the
// content, and the editor's own header dropdown reports what was detected
// (and allows a one-off override). A stored default would only fight the
// detector.
export const EDITOR_SETTING_DEFINITIONS = [
  {
    key: 'textareaEditorWrap',
    label: 'Editor Wrap',
    description: 'Wrap long lines in the large editor',
    type: 'select',
    options: [
      { value: 'nowrap', label: 'No Wrap' },
      { value: 'wrap', label: 'Wrap' }
    ]
  },
  {
    key: 'textareaEditorFontSize',
    label: 'Editor Font Size',
    description: 'Default font size for large editor',
    type: 'select',
    options: TEXTAREA_EDITOR_FONT_SIZE_OPTIONS.map((value) => ({
      value: String(value),
      label: `${value}px`
    }))
  }
];

const settingListeners = new Set();
let cachedSettings = { ...DEFAULT_SETTINGS };

function sanitizeSettingValue(key, value) {
  if (key === 'titleUpdater'
    || key === 'runTestShortcut'
    || key === 'jsonEditor'
    || key === 'outputCopy'
    || key === 'textareaEditor') {
    return Boolean(value);
  }

  if (key === 'textareaEditorWrap') {
    return TEXTAREA_EDITOR_WRAP_OPTIONS.includes(value)
      ? value
      : DEFAULT_SETTINGS.textareaEditorWrap;
  }

  if (key === 'textareaEditorFontSize') {
    const parsed = Number.parseInt(String(value), 10);
    return TEXTAREA_EDITOR_FONT_SIZE_OPTIONS.includes(parsed)
      ? parsed
      : DEFAULT_SETTINGS.textareaEditorFontSize;
  }

  return DEFAULT_SETTINGS[key];
}

function sanitizeSettings(input) {
  const next = { ...DEFAULT_SETTINGS };

  if (!input || typeof input !== 'object') {
    return next;
  }

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      next[key] = sanitizeSettingValue(key, input[key]);
    }
  }

  return next;
}

// chrome.storage.local is the durable, extension-wide store: the content
// scripts on every designer host share one live view of it.
function chromeStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
    ? chrome.storage.local
    : null;
}

function callListener(listener, snapshot) {
  try {
    listener(snapshot);
  } catch (error) {
    console.error('Settings listener failed:', error);
  }
}

function notifySettingsChange() {
  const snapshot = { ...cachedSettings };
  for (const listener of settingListeners) callListener(listener, snapshot);
}

function applyStoredValue(stored) {
  cachedSettings = sanitizeSettings(stored);
  notifySettingsChange();
}

function hydrate() {
  const storage = chromeStorage();
  if (!storage) {
    // No chrome.storage — likely a stale test harness. The defaults stand.
    return;
  }
  storage.get(SETTINGS_STORAGE_KEY, (result) => {
    const stored = result && result[SETTINGS_STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      applyStoredValue(stored);
      return;
    }
    // Nothing stored yet (first run): the defaults stand.
    notifySettingsChange();
  });

  if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) return;
      const next = changes[SETTINGS_STORAGE_KEY].newValue;
      if (!next || typeof next !== 'object') return;
      cachedSettings = sanitizeSettings(next);
      notifySettingsChange();
    });
  }
}

hydrate();

function writeToStorage(settings) {
  const storage = chromeStorage();
  if (!storage) return;
  storage.set({ [SETTINGS_STORAGE_KEY]: settings });
}

export function loadSettings() {
  return { ...cachedSettings };
}

export function saveSettings(nextSettings) {
  cachedSettings = sanitizeSettings(nextSettings);
  writeToStorage(cachedSettings);
  notifySettingsChange();
  return { ...cachedSettings };
}

export function setSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
    return { ...cachedSettings };
  }

  const normalizedValue = sanitizeSettingValue(key, value);
  if (cachedSettings[key] === normalizedValue) {
    return { ...cachedSettings };
  }

  return saveSettings({
    ...cachedSettings,
    [key]: normalizedValue
  });
}

export function subscribeSettings(listener) {
  settingListeners.add(listener);
  // Guarded like every later notification: a subscriber that throws on its
  // first call must not throw out of subscribeSettings() into the caller.
  callListener(listener, loadSettings());

  return () => {
    settingListeners.delete(listener);
  };
}
