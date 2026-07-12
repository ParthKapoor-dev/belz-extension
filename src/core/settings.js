import { SETTINGS_STORAGE_KEY } from '../config/storage-keys.js';

export const TEXTAREA_EDITOR_LANGUAGE_OPTIONS = [
  'auto',
  'sql',
  'spel',
  'javascript',
  'json',
  'plain'
];
export const TEXTAREA_EDITOR_WRAP_OPTIONS = ['nowrap', 'wrap'];
export const TEXTAREA_EDITOR_FONT_SIZE_OPTIONS = [12, 13, 14, 16, 18];

export const DEFAULT_SETTINGS = {
  titleUpdater: true,
  runTestShortcut: true,
  jsonEditor: true,
  outputCopy: true,
  textareaEditor: true,
  textareaEditorLanguage: 'auto',
  textareaEditorWrap: 'nowrap',
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

export const EDITOR_SETTING_DEFINITIONS = [
  {
    key: 'textareaEditorLanguage',
    label: 'Editor Language',
    description: 'Default syntax highlighting mode',
    type: 'select',
    options: TEXTAREA_EDITOR_LANGUAGE_OPTIONS.map((value) => ({
      value,
      label: value === 'auto'
        ? 'Auto'
        : value === 'sql'
          ? 'SQL'
          : value === 'spel'
            ? 'SpEL'
            : value === 'javascript'
              ? 'JavaScript'
              : value === 'json'
                ? 'JSON'
                : 'Plain'
    }))
  },
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
let hydrated = false;

function sanitizeSettingValue(key, value) {
  if (key === 'titleUpdater'
    || key === 'runTestShortcut'
    || key === 'jsonEditor'
    || key === 'outputCopy'
    || key === 'textareaEditor') {
    return Boolean(value);
  }

  if (key === 'textareaEditorLanguage') {
    return TEXTAREA_EDITOR_LANGUAGE_OPTIONS.includes(value)
      ? value
      : DEFAULT_SETTINGS.textareaEditorLanguage;
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

// chrome.storage.local is the durable, extension-wide store. The prior
// localStorage-based build persisted per-origin, so each designer host had a
// separate copy — moving to chrome.storage means options page, content scripts,
// devtools panel, and background all share one live view.
function chromeStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
    ? chrome.storage.local
    : null;
}

function migrateFromLocalStorage() {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(SETTINGS_STORAGE_KEY)
      : null;
    if (!raw) return null;
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function notifySettingsChange() {
  const snapshot = { ...cachedSettings };
  for (const listener of settingListeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('Settings listener failed:', error);
    }
  }
}

function applyStoredValue(stored) {
  cachedSettings = sanitizeSettings(stored);
  hydrated = true;
  notifySettingsChange();
}

function hydrate() {
  const storage = chromeStorage();
  if (!storage) {
    // No chrome.storage — likely a stale test harness. Fall back to defaults
    // and mark hydrated so subscribers don't wait forever.
    hydrated = true;
    return;
  }
  storage.get(SETTINGS_STORAGE_KEY, (result) => {
    const stored = result && result[SETTINGS_STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      applyStoredValue(stored);
      return;
    }
    // First run in this browser profile — try the pre-migration localStorage
    // copy, then persist it to chrome.storage so the migration is one-shot.
    const legacy = migrateFromLocalStorage();
    if (legacy) {
      applyStoredValue(legacy);
      storage.set({ [SETTINGS_STORAGE_KEY]: cachedSettings });
      return;
    }
    hydrated = true;
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

export function isSettingsHydrated() {
  return hydrated;
}

export function saveSettings(nextSettings) {
  cachedSettings = sanitizeSettings(nextSettings);
  writeToStorage(cachedSettings);
  notifySettingsChange();
  return { ...cachedSettings };
}

export function getSetting(key) {
  return Boolean(cachedSettings[key]);
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
  listener(loadSettings());

  return () => {
    settingListeners.delete(listener);
  };
}
