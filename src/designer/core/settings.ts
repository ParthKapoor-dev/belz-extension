/*! belz-singleton: designer/core/settings */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
import { SETTINGS_STORAGE_KEY } from '../../config/storage-keys';

export const TEXTAREA_EDITOR_WRAP_OPTIONS = ['nowrap', 'wrap'] as const;
export const TEXTAREA_EDITOR_FONT_SIZE_OPTIONS = [12, 13, 14, 16, 18] as const;

export type WrapMode = (typeof TEXTAREA_EDITOR_WRAP_OPTIONS)[number];
export type EditorFontSize = (typeof TEXTAREA_EDITOR_FONT_SIZE_OPTIONS)[number];

export interface Settings {
  titleUpdater: boolean;
  runTestShortcut: boolean;
  jsonEditor: boolean;
  outputCopy: boolean;
  textareaEditor: boolean;
  textareaEditorWrap: WrapMode;
  textareaEditorFontSize: EditorFontSize;
}
export type SettingKey = keyof Settings;
export type SettingsListener = (settings: Settings) => void;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  titleUpdater: true,
  runTestShortcut: true,
  jsonEditor: true,
  outputCopy: true,
  textareaEditor: true,
  textareaEditorWrap: 'wrap',
  textareaEditorFontSize: 13
};

/** An on/off setting, shown as a switch. */
export interface FeatureSettingDefinition {
  key: SettingKey;
  label: string;
  description: string;
}

/** A setting with a fixed set of values, shown as a dropdown. */
export interface SelectSettingDefinition extends FeatureSettingDefinition {
  type: 'select';
  options: Array<{ value: string; label: string }>;
}

export const FEATURE_SETTING_DEFINITIONS: FeatureSettingDefinition[] = [
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
export const EDITOR_SETTING_DEFINITIONS: SelectSettingDefinition[] = [
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

const settingListeners = new Set<SettingsListener>();
let cachedSettings: Settings = { ...DEFAULT_SETTINGS };

function sanitizeSettingValue<K extends SettingKey>(key: K, value: unknown): Settings[K];
function sanitizeSettingValue(key: SettingKey, value: unknown): Settings[SettingKey] {
  if (key === 'titleUpdater'
    || key === 'runTestShortcut'
    || key === 'jsonEditor'
    || key === 'outputCopy'
    || key === 'textareaEditor') {
    return Boolean(value);
  }

  if (key === 'textareaEditorWrap') {
    return TEXTAREA_EDITOR_WRAP_OPTIONS.includes(value as WrapMode)
      ? (value as WrapMode)
      : DEFAULT_SETTINGS.textareaEditorWrap;
  }

  if (key === 'textareaEditorFontSize') {
    const parsed = Number.parseInt(String(value), 10);
    return TEXTAREA_EDITOR_FONT_SIZE_OPTIONS.includes(parsed as EditorFontSize)
      ? (parsed as EditorFontSize)
      : DEFAULT_SETTINGS.textareaEditorFontSize;
  }

  return DEFAULT_SETTINGS[key];
}

function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}

function sanitizeSettings(input: unknown): Settings {
  const next: Settings = { ...DEFAULT_SETTINGS };

  if (!input || typeof input !== 'object') {
    return next;
  }

  const record = input as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      (next as Record<SettingKey, unknown>)[key] = sanitizeSettingValue(key, record[key]);
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

function callListener(listener: SettingsListener, snapshot: Settings): void {
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

function applyStoredValue(stored: unknown): void {
  cachedSettings = sanitizeSettings(stored);
  notifySettingsChange();
}

function hydrate() {
  const storage = chromeStorage();
  if (!storage) {
    // No chrome.storage — likely a stale test harness. The defaults stand.
    return;
  }
  storage.get(SETTINGS_STORAGE_KEY, (result: Record<string, unknown>) => {
    const stored = result && result[SETTINGS_STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      applyStoredValue(stored);
      return;
    }
    // Nothing stored yet (first run): the defaults stand.
    notifySettingsChange();
  });

  if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
    chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) return;
      const next = changes[SETTINGS_STORAGE_KEY].newValue;
      if (!next || typeof next !== 'object') return;
      cachedSettings = sanitizeSettings(next);
      notifySettingsChange();
    });
  }
}

hydrate();

function writeToStorage(settings: Settings): void {
  const storage = chromeStorage();
  if (!storage) return;
  storage.set({ [SETTINGS_STORAGE_KEY]: settings });
}

export function loadSettings(): Settings {
  return { ...cachedSettings };
}

export function saveSettings(nextSettings: unknown): Settings {
  cachedSettings = sanitizeSettings(nextSettings);
  writeToStorage(cachedSettings);
  notifySettingsChange();
  return { ...cachedSettings };
}

export function setSetting(key: string, value: unknown): Settings {
  if (!isSettingKey(key)) {
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

export function subscribeSettings(listener: SettingsListener): () => void {
  settingListeners.add(listener);
  // Guarded like every later notification: a subscriber that throws on its
  // first call must not throw out of subscribeSettings() into the caller.
  callListener(listener, loadSettings());

  return () => {
    settingListeners.delete(listener);
  };
}
