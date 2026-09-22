// JSON value -> the string an AD test input holds, per declared input type.
//
// Pure: no DOM. sync.js uses this to validate and normalise every value before
// it drives the page, so a bad value is reported without touching anything.

export const STRUCTURED_TYPES = new Set(['Json', 'Array', 'Map', 'StructuredData']);
export const DATE_TYPES = new Set(['Date', 'DateTime']);

export function padTwo(value) {
  return String(value).padStart(2, '0');
}

function formatDateAsYMD(date) {
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
}

function normalizeBooleanValue(value) {
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

function normalizeNumberValue(value, type) {
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
export function parseDateValue(value) {
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

  const datePart = input.split(/[T\s]/)[0];

  let isoDate = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    isoDate = datePart;
  } else {
    const ymdSlash = datePart.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    const mdySlash = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ymdSlash) {
      isoDate = `${ymdSlash[1]}-${padTwo(ymdSlash[2])}-${padTwo(ymdSlash[3])}`;
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

export function normalizeValueForType(value, type) {
  if (type === 'Boolean') return normalizeBooleanValue(value);
  if (type === 'Integer' || type === 'Number') return normalizeNumberValue(value, type);

  if (DATE_TYPES.has(type)) {
    const parsed = parseDateValue(value);
    return parsed.valid
      ? { valid: true, stringValue: parsed.date, dateInfo: parsed }
      : { valid: false, error: parsed.error };
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
