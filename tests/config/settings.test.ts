import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SETTINGS,
  SETTINGS,
  SETTING_KEYS,
  sanitizeSetting,
  sanitizeSettings,
  settingsIn,
  type SettingSpec
} from '../../src/config/settings';

describe('settings schema', () => {
  test('every select default is one of its own options', () => {
    for (const key of SETTING_KEYS) {
      const spec: SettingSpec = SETTINGS[key];
      if (spec.kind !== 'select') continue;
      expect(spec.options.map((o) => o.value)).toContain(spec.default);
    }
  });

  test('every setting is shown in exactly one modal section', () => {
    const shown = [...settingsIn('features'), ...settingsIn('ide'), ...settingsIn('advanced')].map(([k]) => k);
    expect(shown.sort()).toEqual([...SETTING_KEYS].sort());
  });

  test('defaults come from the schema', () => {
    expect(DEFAULT_SETTINGS.ideFontSize).toBe(13);
    expect(DEFAULT_SETTINGS.debugLogging).toBe(false);
    expect(DEFAULT_SETTINGS.jsonEditor).toBe(true);
  });
});

describe('sanitizeSetting', () => {
  test('select values compare as text and come back typed', () => {
    expect(sanitizeSetting('ideFontSize', '16')).toBe(16);
    expect(sanitizeSetting('ideFontSize', ' 16px')).toBe(16);
    expect(sanitizeSetting('ideWrap', 'nowrap')).toBe('nowrap');
  });

  test('an unknown select value falls back to the default', () => {
    expect(sanitizeSetting('ideFontSize', 99)).toBe(13);
    expect(sanitizeSetting('ideWrap', 'sideways')).toBe('wrap');
    expect(sanitizeSetting('ideWrap', undefined)).toBe('wrap');
  });

  test('toggles are coerced to booleans', () => {
    expect(sanitizeSetting('outputCopy', 0)).toBe(false);
    expect(sanitizeSetting('outputCopy', 'yes')).toBe(true);
  });
});

describe('sanitizeSettings', () => {
  test('fills missing keys and drops unknown ones', () => {
    const s = sanitizeSettings({ jsonEditor: false, retired: 1 });
    expect(s.jsonEditor).toBe(false);
    expect(s.titleUpdater).toBe(true);
    expect('retired' in s).toBe(false);
  });

  test('anything that is not an object gives the defaults', () => {
    expect(sanitizeSettings(null)).toEqual({ ...DEFAULT_SETTINGS });
    expect(sanitizeSettings('x')).toEqual({ ...DEFAULT_SETTINGS });
  });
});
