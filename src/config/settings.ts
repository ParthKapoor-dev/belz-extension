// The one list of user settings. Each entry says what the setting is called,
// its default, the values it accepts and where the settings modal shows it.
// The Settings type, the defaults, validation and the modal's rows are all
// derived from this list: adding a setting means adding one entry here.

/** Where the settings modal shows a setting. */
export type SettingSection = 'features' | 'editor' | 'advanced';

/** An on/off setting, shown as a switch. */
export interface ToggleSpec {
  kind: 'toggle';
  default: boolean;
  label: string;
  description: string;
  section: SettingSection;
}

/** A setting with a fixed set of values, shown as a dropdown. */
export interface SelectSpec<V extends string | number = string | number> {
  kind: 'select';
  default: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  label: string;
  description: string;
  section: SettingSection;
}

export type SettingSpec = ToggleSpec | SelectSpec;

function toggle(section: SettingSection, label: string, description: string, byDefault = true): ToggleSpec {
  return { kind: 'toggle', default: byDefault, label, description, section };
}

function select<const V extends string | number>(spec: Omit<SelectSpec<V>, 'kind'>): SelectSpec<V> {
  return { kind: 'select', ...spec };
}

const FONT_SIZES = [12, 13, 14, 16, 18] as const;

export const SETTINGS = {
  titleUpdater: toggle('features', 'Title Updater', 'Update tab title with AD/PD method/page name'),
  runTestShortcut: toggle('features', 'Keyboard Shortcuts', 'Ctrl+Shift+Enter run test · Shift+L copy link · Esc Esc unfocus'),
  jsonEditor: toggle('features', 'JSON Editor', 'Show JSON input button and modal editor'),
  outputCopy: toggle('features', 'Output Copy', 'Show Copy button near output containers'),
  textareaEditor: toggle('features', 'Textarea Editor', 'Show Open button for native textareas'),

  // The editor language is not a setting: it is always detected from the
  // content, and the editor's own header dropdown reports what was detected
  // (and allows a one-off override). A stored default would only fight the
  // detector.
  textareaEditorWrap: select({
    section: 'editor',
    label: 'Editor Wrap',
    description: 'Wrap long lines in the large editor',
    default: 'wrap',
    options: [
      { value: 'nowrap', label: 'No Wrap' },
      { value: 'wrap', label: 'Wrap' }
    ]
  }),
  textareaEditorFontSize: select({
    section: 'editor',
    label: 'Editor Font Size',
    description: 'Default font size for large editor',
    default: 13,
    options: FONT_SIZES.map((value) => ({ value, label: `${value}px` }))
  }),

  debugLogging: toggle(
    'advanced',
    'Debug Logging',
    'Print the extension\'s debug messages to the browser console',
    false
  )
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SETTINGS;

type ValueOf<S> = S extends ToggleSpec ? boolean : S extends SelectSpec<infer V> ? V : never;
export type Settings = { [K in SettingKey]: ValueOf<(typeof SETTINGS)[K]> };

export type WrapMode = Settings['textareaEditorWrap'];
export type EditorFontSize = Settings['textareaEditorFontSize'];

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze(
  Object.fromEntries(SETTING_KEYS.map((key) => [key, SETTINGS[key].default])) as Settings
);

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

/** The settings of one modal section, in declaration order. */
export function settingsIn(section: SettingSection): Array<[SettingKey, SettingSpec]> {
  return SETTING_KEYS
    .map((key): [SettingKey, SettingSpec] => [key, SETTINGS[key]])
    .filter(([, spec]) => spec.section === section);
}

/**
 * `value` as a valid value of setting `key`, or the default. Numeric options
 * accept anything that parses to them, so `'16'` from a <select> element (or
 * `'16px'`) is read as 16.
 */
export function sanitizeSetting<K extends SettingKey>(key: K, value: unknown): Settings[K] {
  const spec: SettingSpec = SETTINGS[key];
  if (spec.kind === 'toggle') return Boolean(value) as Settings[K];
  const parsed = Number.parseInt(String(value), 10);
  const match = spec.options.find((option) =>
    typeof option.value === 'number' ? option.value === parsed : option.value === value
  );
  return (match ? match.value : spec.default) as Settings[K];
}

/** A full, valid Settings object from whatever was stored. Missing keys get their default. */
export function sanitizeSettings(input: unknown): Settings {
  const next: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  if (!input || typeof input !== 'object') return next as Settings;
  const record = input as Record<string, unknown>;
  for (const key of SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      next[key] = sanitizeSetting(key, record[key]);
    }
  }
  return next as Settings;
}
