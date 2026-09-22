// JSON value -> the string an AD test input holds, per declared input type.
//
// Pure: no DOM. sync.ts uses this to validate and normalise every value before
// it drives the page, so a bad value is reported without touching anything.

import type { DataType } from './types';

export const STRUCTURED_TYPES: ReadonlySet<DataType> = new Set<DataType>(['Json', 'Array', 'Map', 'StructuredData']);
export const DATE_TYPES: ReadonlySet<DataType> = new Set<DataType>(['Date', 'DateTime']);

/** A parsed date, plus a time of day when the value carried one. */
export interface DateInfo {
  /** `YYYY-MM-DD`, or '' to clear the field. */
  date: string;
  hasTime: boolean;
  hour: number;
  minute: number;
}

type Invalid = { valid: false; error: string };

export type ParsedDate = ({ valid: true } & DateInfo) | Invalid;

/** A JSON value validated for an input type, as the text the input holds. */
export type NormalizedValue =
  | { valid: true; stringValue: string; dateInfo?: DateInfo }
  | Invalid;

export function padTwo(value: number | string): string {
  return String(value).padStart(2, '0');
}

function formatDateAsYMD(date: Date): string {
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
}

function normalizeBooleanValue(value: unknown): NormalizedValue {
  if (value === null || value === undefined || value === '') {
    return { valid: true, stringValue: '' };
  }
  if (typeof value === 'boolean') {
    return { valid: true, stringValue: value ? 'Yes' : 'No' };
  }
  if (typeof value === 'number') {
    if (value === 1) return { valid: true, stringValue: 'Yes' };
    if (value === 0) return { valid: true, stringValue: 'No' };
    return { valid: false, error: `Unsupported boolean number: ${value}` };
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['yes', 'true', '1'].includes(normalized)) return { valid: true, stringValue: 'Yes' };
    if (['no', 'false', '0'].includes(normalized)) return { valid: true, stringValue: 'No' };
    return { valid: false, error: `Unsupported boolean string: "${value}"` };
  }
  return { valid: false, error: `Unsupported boolean value type: ${typeof value}` };
}

function normalizeNumberValue(value: unknown, type: 'Integer' | 'Number'): NormalizedValue {
  if (value === null || value === undefined || value === '') {
    return { valid: true, stringValue: '' };
  }
  const normalized = typeof value === 'number' ? value : Number(String(value).trim());
  if (Number.isNaN(normalized)) {
    return { valid: false, error: `Invalid ${type.toLowerCase()} value: ${value}` };
  }
  if (type === 'Integer' && !Number.isInteger(normalized)) {
    return { valid: false, error: `Expected integer, got: ${value}` };
  }
  return { valid: true, stringValue: String(normalized) };
}

// Parses a date (and optional time) into a normalised ISO date plus clock
// fields. Accepts ISO, `YYYY/M/D`, `M/D/YYYY`, `D/M/YYYY` and loose strings.
export function parseDateValue(value: unknown): ParsedDate {
  if (value === null || value === undefined || value === '') {
    return { valid: true, date: '', hasTime: false, hour: 0, minute: 0 };
  }

  let hour = 0;
  let minute = 0;
  let hasTime = false;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      valid: true,
      date: formatDateAsYMD(value),
      hasTime: true,
      hour: value.getHours(),
      minute: value.getMinutes()
    };
  }

  if (typeof value !== 'string') {
    return { valid: false, error: `Invalid date value: ${String(value)}` };
  }

  const input = value.trim();

  // Pull a HH:MM time out of an ISO/loose datetime string.
  const timeMatch = input.match(/[T\s](\d{1,2}):(\d{2})/);
  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    hasTime = hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
  }

  const datePart = input.split(/[T\s]/)[0] ?? '';

  let isoDate: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    isoDate = datePart;
  } else {
    const ymdSlash = datePart.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    const mdySlash = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ymdSlash) {
      isoDate = `${ymdSlash[1]}-${padTwo(ymdSlash[2]!)}-${padTwo(ymdSlash[3]!)}`;
    } else if (mdySlash) {
      const first = Number(mdySlash[1]);
      const second = Number(mdySlash[2]);
      // Disambiguate MM/DD vs DD/MM when the first part can't be a month.
      if (first > 12 && second >= 1 && second <= 12) {
        isoDate = `${mdySlash[3]}-${padTwo(second)}-${padTwo(first)}`;
      } else {
        isoDate = `${mdySlash[3]}-${padTwo(first)}-${padTwo(second)}`;
      }
    } else {
      const parsed = new Date(input);
      if (!Number.isNaN(parsed.getTime())) {
        isoDate = formatDateAsYMD(parsed);
        if (!hasTime && /\d{1,2}:\d{2}/.test(input)) {
          hour = parsed.getHours();
          minute = parsed.getMinutes();
          hasTime = true;
        }
      }
    }
  }

  if (!isoDate) {
    return { valid: false, error: `Invalid date value: ${String(value)}` };
  }
  return { valid: true, date: isoDate, hasTime, hour, minute };
}

export function normalizeValueForType(value: unknown, type: DataType): NormalizedValue {
  if (type === 'Boolean') return normalizeBooleanValue(value);
  if (type === 'Integer' || type === 'Number') return normalizeNumberValue(value, type);

  if (DATE_TYPES.has(type)) {
    const parsed = parseDateValue(value);
    if (!parsed.valid) return parsed;
    const { date, hasTime, hour, minute } = parsed;
    return { valid: true, stringValue: date, dateInfo: { date, hasTime, hour, minute } };
  }

  if (STRUCTURED_TYPES.has(type) && value !== null && value !== undefined) {
    if (typeof value === 'string') return { valid: true, stringValue: value };
    if (typeof value === 'object') {
      return { valid: true, stringValue: JSON.stringify(value, null, 2) };
    }
    return { valid: true, stringValue: String(value) };
  }

  if (typeof value === 'object' && value !== null) {
    return { valid: true, stringValue: JSON.stringify(value, null, 2) };
  }
  if (value === null || value === undefined) {
    return { valid: true, stringValue: '' };
  }
  return { valid: true, stringValue: String(value) };
}
