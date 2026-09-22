import { describe, expect, test } from 'bun:test';
import {
  normalizeValueForType,
  parseDateValue
} from '../../../src/designer/features/json-editor/values';
import { generateInputJSON, normalizeDataType } from '../../../src/designer/features/json-editor/types';

describe('normalizeDataType', () => {
  test.each([
    ['Text', 'Text'],
    ['  boolean ', 'Boolean'],
    ['interger', 'Integer'], // a typo the AD UI really shows
    ['Date Time', 'DateTime'],
    ['Structured Data', 'StructuredData'], // non-breaking space from innerHTML
    ['something new', 'Text'],
    ['', 'Text']
  ])('%p -> %p', (raw, expected) => {
    expect(normalizeDataType(raw)).toBe(expected);
  });
});

describe('normalizeValueForType', () => {
  test('booleans accept the usual spellings', () => {
    for (const v of [true, 'yes', 'TRUE', '1', 1]) {
      expect(normalizeValueForType(v, 'Boolean')).toEqual({ valid: true, stringValue: 'Yes' });
    }
    for (const v of [false, 'no', 'False', '0', 0]) {
      expect(normalizeValueForType(v, 'Boolean')).toEqual({ valid: true, stringValue: 'No' });
    }
    expect(normalizeValueForType('maybe', 'Boolean').valid).toBe(false);
    expect(normalizeValueForType(2, 'Boolean').valid).toBe(false);
    expect(normalizeValueForType(null, 'Boolean')).toEqual({ valid: true, stringValue: '' });
  });

  test('numbers and integers', () => {
    expect(normalizeValueForType(' 42 ', 'Number')).toEqual({ valid: true, stringValue: '42' });
    expect(normalizeValueForType(1.5, 'Number')).toEqual({ valid: true, stringValue: '1.5' });
    expect(normalizeValueForType(1.5, 'Integer').valid).toBe(false);
    expect(normalizeValueForType('abc', 'Number').valid).toBe(false);
  });

  test('structured types serialise objects as indented JSON', () => {
    expect(normalizeValueForType({ a: 1 }, 'Json')).toEqual({ valid: true, stringValue: '{\n  "a": 1\n}' });
    expect(normalizeValueForType('[1]', 'Array')).toEqual({ valid: true, stringValue: '[1]' });
  });

  test('text: objects become JSON, null becomes empty', () => {
    expect(normalizeValueForType({ a: 1 }, 'Text').stringValue).toBe('{\n  "a": 1\n}');
    expect(normalizeValueForType(null, 'Text')).toEqual({ valid: true, stringValue: '' });
    expect(normalizeValueForType(7, 'Text')).toEqual({ valid: true, stringValue: '7' });
  });

  test('dates carry the parsed date info', () => {
    const r = normalizeValueForType('2026-03-04T09:05', 'DateTime');
    expect(r.valid).toBe(true);
    expect(r.stringValue).toBe('2026-03-04');
    expect(r.dateInfo).toMatchObject({ hasTime: true, hour: 9, minute: 5 });
  });
});

describe('parseDateValue', () => {
  test.each([
    ['2026-03-04', '2026-03-04'],
    ['2026/3/4', '2026-03-04'],
    ['03/04/2026', '2026-03-04'], // month first by default
    ['25/12/2026', '2026-12-25'] // day first when the first part cannot be a month
  ])('%p -> %p', (input, iso) => {
    expect(parseDateValue(input)).toMatchObject({ valid: true, date: iso });
  });

  test('rejects garbage and non-strings', () => {
    expect(parseDateValue('not a date').valid).toBe(false);
    expect(parseDateValue(12).valid).toBe(false);
  });

  test('empty means "clear the field"', () => {
    expect(parseDateValue('')).toEqual({ valid: true, date: '', hasTime: false, hour: 0, minute: 0 });
  });
});

describe('generateInputJSON', () => {
  test('converts page values back to JSON by type', () => {
    const json = generateInputJSON([
      { key: 'name', type: 'Text', currentValue: 'Ann' },
      { key: 'age', type: 'Integer', currentValue: '30' },
      { key: 'bad', type: 'Number', currentValue: 'x' },
      { key: 'ok', type: 'Boolean', currentValue: 'Yes' },
      { key: 'meta', type: 'Json', currentValue: '{"a":1}' },
      { key: 'broken', type: 'Json', currentValue: '{oops' },
      { key: 'empty', type: 'Text', currentValue: '   ' }
    ]);
    expect(json).toEqual({
      name: 'Ann',
      age: 30,
      bad: null,
      ok: true,
      meta: { a: 1 },
      broken: '{oops',
      empty: null
    });
  });
});
