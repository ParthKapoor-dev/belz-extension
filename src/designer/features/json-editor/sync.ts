import { extractAllInputs } from './extractor';
import { DATE_TYPES, normalizeValueForType, padTwo, type DateInfo } from './values';
import type { DataType } from './types';
import { AD_WIDGETS } from '../../../config/selectors';
import { TIMINGS } from '../../../config/timings';
import { firstMatch } from '../../utils/dom';
import { createLogger } from '../../../shared/logger';

const log = createLogger('json-editor');

/** Outcome of writing one value into one input. */
export interface PopulateResult {
  success: boolean;
  /** Not attempted on purpose (a file input), rather than failed. */
  skipped?: boolean;
  error?: string;
}

/** Outcome of a whole JSON sync. */
export interface SyncResult {
  success: boolean;
  message?: string;
  errors?: string[];
  warnings?: string[];
  filledCount: number;
  /** JSON keys with no matching input on the page. */
  skippedMissingKeys: string[];
  /** Keys whose value could not be written or confirmed. */
  failedKeys: string[];
}

// JSON -> AD test-input synchronisation.
//
// Every type is driven through the real AD UI (native value setter + events
// for plain fields, simulated clicks for the `exp-*` custom widgets), then the
// written value is read back and verified. `window.ng` is not exposed on the
// production build and `__ngContext__` is an opaque numeric index, so driving
// Angular component instances directly is not an option here.

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

// ---- low-level DOM helpers ------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls `fn` until it returns a truthy value or the attempts run out.
async function waitFor<T>(
  fn: () => T | null | undefined | false,
  { tries, interval }: { tries: number; interval: number } = TIMINGS.widgetPoll
): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const result = fn();
      if (result) return result;
    } catch {
      // keep polling
    }
    await sleep(interval);
  }
  return null;
}

// Writes through the prototype's `value` setter so Angular/React value
// tracking sees the change.
function nativeSetValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(element);
  const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && typeof descriptor.set === 'function') {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function fireInputEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  if (typeof InputEvent !== 'undefined') {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
  }
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

// AD's date/time widgets open, page and commit on a single native click.
// `.click()` dispatches exactly one click event — important, because those
// widgets toggle, so a second click would immediately close them again. A full
// synthetic PointerEvent sequence was also observed to lock up the date
// picker, so deliberately keep this to the element's own click.
function mouseClick(element: Element | null | undefined): void {
  if (!element) return;
  try {
    element.scrollIntoView({ block: 'center', inline: 'center' });
  } catch {
    // detached node — ignore
  }
  try {
    (element as HTMLElement).click();
  } catch {
    // ignore
  }
}

// ---- per-type setters -----------------------------------------------------
// Plain <textarea>/<input>: native write + events, verified by read-back.
function setTextValue(element: HTMLInputElement | HTMLTextAreaElement, stringValue: string): boolean {
  try {
    element.focus();
  } catch {
    // ignore
  }
  if (element.hasAttribute('readonly')) {
    element.removeAttribute('readonly');
  }
  nativeSetValue(element, stringValue);
  fireInputEvents(element);
  try {
    element.blur();
  } catch {
    // ignore
  }
  element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  return (element.value ?? '') === stringValue;
}

// Boolean <exp-select>: open the dropdown, click the matching option.
async function setBooleanValue(expSelect: HTMLElement, stringValue: string): Promise<boolean> {
  const currentText = () =>
    expSelect.querySelector(AD_WIDGETS.select.text)?.textContent?.trim() || '';

  if (stringValue === '') {
    // No reliable "clear" affordance — treat an already-empty select as done.
    return currentText() === '';
  }
  if (currentText().toLowerCase() === stringValue.toLowerCase()) return true;

  const trigger = firstMatch(expSelect, AD_WIDGETS.select.triggers) || expSelect;
  mouseClick(trigger);

  const wanted = stringValue.toLowerCase();
  const option = await waitFor(() => {
    const scopes = [expSelect, document];
    for (const scope of scopes) {
      for (const opt of scope.querySelectorAll<HTMLElement>(AD_WIDGETS.select.option)) {
        if (
          opt.offsetParent !== null &&
          opt.textContent?.trim().toLowerCase() === wanted
        ) {
          return opt.closest('a') || opt;
        }
      }
    }
    return null;
  });
  if (!option) return false;

  mouseClick(option);
  await sleep(TIMINGS.afterSelectOption);
  return currentText().toLowerCase() === wanted;
}

function parseMonthLabel(text: string): { year: number; month: number } | null {
  const lower = (text || '').toLowerCase();
  const yearMatch = lower.match(/\b(19|20)\d{2}\b/);
  // AD's calendar header abbreviates month names ("Jun 2026"), so match on the
  // first three letters — which are unique across all twelve months — rather
  // than the full name.
  const monthIndex = MONTHS.findIndex((m) => lower.includes(m.slice(0, 3)));
  if (!yearMatch || monthIndex < 0) return null;
  return { year: Number(yearMatch[0]), month: monthIndex + 1 };
}

/** How many months the calendar may be paged to reach a date, either way. */
const MAX_CALENDAR_PAGES = 60;
/** Clicks in a row that may leave the month unchanged before paging gives up. */
const MAX_CALENDAR_STALLS = 3;

/**
 * Page an open AD calendar to `year`/`month` (1-12). Resolves true once that
 * month is showing, false when it cannot get there: an unreadable month, a
 * missing arrow, arrows that stop moving the month, or a date too far away.
 */
export async function pageCalendarTo(calendar: Element, year: number, month: number): Promise<boolean> {
  const targetIndex = year * 12 + month;
  let previousIndex = -1;
  let stalls = 0;
  for (let page = 0; page <= MAX_CALENDAR_PAGES; page++) {
    const label = calendar.querySelector(AD_WIDGETS.datePicker.monthLabel);
    const current = label && parseMonthLabel(label.textContent || '');
    if (!current) return false;

    const currentIndex = current.year * 12 + current.month;
    if (currentIndex === targetIndex) return true;
    if (page === MAX_CALENDAR_PAGES) return false;
    stalls = currentIndex === previousIndex ? stalls + 1 : 0;
    if (stalls >= MAX_CALENDAR_STALLS) return false;
    previousIndex = currentIndex;

    const navButton = calendar.querySelector(
      currentIndex < targetIndex
        ? AD_WIDGETS.datePicker.nextMonth
        : AD_WIDGETS.datePicker.prevMonth
    );
    if (!navButton) return false;
    // The arrow's click handler lives on an inner <button>.
    mouseClick(navButton.querySelector('button') || navButton);
    await sleep(TIMINGS.afterCalendarPage);
  }
  return false;
}

// Opens AD's custom calendar for an <exp-date-picker> and returns its root.
async function openAdCalendar(datePickerRoot: HTMLElement): Promise<Element | null> {
  const findCalendar = () =>
    datePickerRoot.querySelector(AD_WIDGETS.datePicker.calendar) ||
    document.querySelector(AD_WIDGETS.datePicker.calendar);

  const existing = findCalendar();
  if (existing) return existing;

  const triggers = [
    ...AD_WIDGETS.datePicker.triggers.map((s) => datePickerRoot.querySelector(s)),
    datePickerRoot
  ].filter(Boolean);

  for (const trigger of triggers) {
    mouseClick(trigger);
    const calendar = await waitFor(findCalendar, TIMINGS.popupPoll);
    if (calendar) return calendar;
  }
  return null;
}

// Date <exp-date-picker>: open the calendar, page to the target month, click
// the day cell. AD ships its own calendar markup (`.calendar_*`).
async function setDateValue(datePickerRoot: HTMLElement, isoDate: string): Promise<boolean> {
  const input =
    datePickerRoot.querySelector<HTMLInputElement>(AD_WIDGETS.datePicker.input) ||
    datePickerRoot.querySelector<HTMLInputElement>('input');

  if (!isoDate) {
    if (input) {
      input.removeAttribute('readonly');
      nativeSetValue(input, '');
      fireInputEvents(input);
    }
    return !input || (input.value ?? '') === '';
  }

  if (input && input.value === isoDate) return true;

  const [year = 0, month = 0, day = 0] = isoDate.split('-').map(Number);
  const calendar = await openAdCalendar(datePickerRoot);
  if (!calendar) return false;

  // Page month-by-month to the target. The day cells only mean the target
  // date once the target month is showing: if it never is (a label that does
  // not parse, a missing arrow, a date too far away), click nothing.
  if (!(await pageCalendarTo(calendar, year, month))) return false;

  // Click the matching current-month day cell.
  const dayCell = await waitFor(() => {
    for (const cell of calendar.querySelectorAll(AD_WIDGETS.datePicker.day)) {
      if (/disable/.test(cell.className)) continue;
      const valueEl = cell.querySelector(AD_WIDGETS.datePicker.dayValue) || cell;
      if ((valueEl.textContent || '').trim() === String(day)) return cell;
    }
    return null;
  });
  if (!dayCell) return false;

  mouseClick(dayCell);
  await sleep(TIMINGS.afterDayClick);

  const finalValue = (input?.value || '').trim();
  return finalValue === isoDate || finalValue.includes(isoDate);
}

// DateTime <exp-timepicker>: hour/minute are editable inputs; AM-PM is a
// spinner toggled with its chevron.
async function setTimeValue(expDateTime: HTMLElement, hour24: number, minute: number): Promise<boolean> {
  const timepicker = expDateTime.querySelector(AD_WIDGETS.timePicker.host);
  if (!timepicker) return false;

  const triggers = [
    ...AD_WIDGETS.timePicker.triggers.map((s) => timepicker.querySelector(s)),
    timepicker
  ].filter(Boolean);

  let inputs: HTMLInputElement[] | null = null;
  for (const trigger of triggers) {
    mouseClick(trigger);
    inputs = await waitFor(() => {
      const visible = Array.from(
        document.querySelectorAll<HTMLInputElement>(AD_WIDGETS.timePicker.inputs)
      ).filter((el) => el.offsetParent !== null);
      return visible.length >= 2 ? visible : null;
    }, TIMINGS.popupPoll);
    if (inputs) break;
  }
  if (!inputs) return false;

  const ampmInput = inputs[2] || null; // present only in 12-hour mode
  let hour = hour24;
  let ampm: 'AM' | 'PM' | null = null;
  if (ampmInput) {
    ampm = hour24 >= 12 ? 'PM' : 'AM';
    hour = hour24 % 12;
    if (hour === 0) hour = 12;
  }

  const [hourInput, minuteInput] = inputs as [HTMLInputElement, HTMLInputElement];
  setTextValue(hourInput, String(hour));
  setTextValue(minuteInput, padTwo(minute));

  if (ampmInput && ampmInput.value.trim().toUpperCase() !== ampm) {
    const column = ampmInput.parentElement;
    const chevron = column && column.querySelector(AD_WIDGETS.timePicker.ampmToggle);
    if (chevron) {
      mouseClick(chevron.querySelector('button') || chevron);
      await sleep(TIMINGS.afterAmPmToggle);
    }
  }

  // Commit by clicking away from the popup.
  mouseClick(document.body);
  await sleep(TIMINGS.afterTimeCommit);

  const hourOk = String(hourInput.value).trim() === String(hour);
  const minuteOk = Number(minuteInput.value) === Number(minute);
  const ampmOk = !ampmInput || ampmInput.value.trim().toUpperCase() === ampm;
  return hourOk && minuteOk && ampmOk;
}

// DateTime <exp-date-time>: a calendar plus a timepicker.
async function setDateTimeValue(expDateTime: HTMLElement, dateInfo: DateInfo): Promise<boolean> {
  const datePicker = expDateTime.querySelector<HTMLElement>(AD_WIDGETS.datePicker.host) || expDateTime;
  let ok = await setDateValue(datePicker, dateInfo.date);
  if (dateInfo.date && dateInfo.hasTime) {
    ok = (await setTimeValue(expDateTime, dateInfo.hour, dateInfo.minute)) && ok;
  }
  return ok;
}

// ===== Public: populate one input =========================================
export async function populateTestValue(
  element: HTMLElement | null,
  value: unknown,
  type: DataType
): Promise<PopulateResult> {
  if (type === 'File') {
    return {
      success: false,
      skipped: true,
      error: 'File inputs cannot be auto-filled by the extension'
    };
  }
  if (!element) {
    return { success: false, error: 'No input element found on the page' };
  }

  const normalized = normalizeValueForType(value, type);
  if (!normalized.valid) {
    return { success: false, error: normalized.error };
  }

  let ok = false;
  try {
    if (type === 'Boolean') {
      ok = await setBooleanValue(element, normalized.stringValue);
    } else if (type === 'Date') {
      ok = await setDateValue(element, normalized.stringValue);
    } else if (type === 'DateTime') {
      ok = await setDateTimeValue(element, normalized.dateInfo!);
    } else {
      ok = setTextValue(element as HTMLInputElement | HTMLTextAreaElement, normalized.stringValue);
    }
  } catch (error) {
    return { success: false, error: `Error writing ${type}: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (!ok) {
    return { success: false, error: `Could not confirm ${type} value on the page` };
  }
  log.debug(`Populated ${type} input`);
  return { success: true };
}

// ===== Public: sync a JSON object to the page =============================
export async function syncJSONToInputs(jsonString: string): Promise<SyncResult> {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch (error) {
    return {
      success: false,
      errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
      filledCount: 0,
      skippedMissingKeys: [],
      failedKeys: []
    };
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      success: false,
      errors: ['JSON must be an object with key-value pairs'],
      filledCount: 0,
      skippedMissingKeys: [],
      failedKeys: []
    };
  }

  const inputs = extractAllInputs();
  if (inputs.length === 0) {
    return {
      success: false,
      errors: ['No inputs found on page. Make sure Test Mode is on and you are on the Inputs step.'],
      filledCount: 0,
      skippedMissingKeys: [],
      failedKeys: []
    };
  }

  const inputMap = new Map(inputs.map((input) => [input.key, input]));
  const skippedMissingKeys: string[] = [];
  const failedKeys: string[] = [];
  const fileSkippedKeys: string[] = [];
  const warnings: string[] = [];
  let filledCount = 0;

  // Date/DateTime fields are processed last — opening their calendar/timepicker
  // overlays can otherwise interfere with sibling fields still being written.
  const record = data as Record<string, unknown>;
  const isDateKey = (key: string) => {
    const type = inputMap.get(key)?.type;
    return type !== undefined && DATE_TYPES.has(type);
  };
  const entries = Object.entries(record).sort(([keyA], [keyB]) => {
    const aIsDate = isDateKey(keyA);
    const bIsDate = isDateKey(keyB);
    if (aIsDate === bIsDate) return 0;
    return aIsDate ? 1 : -1;
  });

  for (const [key, value] of entries) {
    const input = inputMap.get(key);
    if (!input) {
      skippedMissingKeys.push(key);
      continue;
    }

    const result = await populateTestValue(input.testValueElement, value, input.type);
    if (result.success) {
      filledCount++;
    } else if (result.skipped) {
      fileSkippedKeys.push(key);
      log.debug(`Skipped ${key}: ${result.error}`);
    } else {
      failedKeys.push(key);
      log.debug(`Failed to populate ${key}: ${result.error}`);
    }
  }

  if (skippedMissingKeys.length > 0) {
    warnings.push(
      `Not found on page (${skippedMissingKeys.length}): ${skippedMissingKeys.join(', ')}`
    );
  }
  if (fileSkippedKeys.length > 0) {
    warnings.push(
      `File input(s) skipped — pick the file manually (${fileSkippedKeys.length}): ${fileSkippedKeys.join(', ')}`
    );
  }
  if (failedKeys.length > 0) {
    warnings.push(`Failed to populate (${failedKeys.length}): ${failedKeys.join(', ')}`);
  }

  const totalKeys = Object.keys(record).length;
  const message = `Populated ${filledCount} of ${totalKeys} input(s)`;

  if (filledCount === 0) {
    return {
      success: false,
      message,
      errors: warnings.length > 0 ? warnings : ['No matching inputs were populated.'],
      warnings: warnings.length > 0 ? warnings : undefined,
      filledCount,
      skippedMissingKeys,
      failedKeys
    };
  }

  return {
    success: true,
    message,
    warnings: warnings.length > 0 ? warnings : undefined,
    filledCount,
    skippedMissingKeys,
    failedKeys
  };
}
