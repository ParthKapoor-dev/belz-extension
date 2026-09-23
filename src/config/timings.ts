// How long the extension waits for the designer pages, in milliseconds.
//
// The designers render asynchronously (Angular), and their custom widgets
// animate open and closed. These waits were tuned by hand against the current
// AD UI: if a designer release makes a feature flaky (a dropdown option not
// found, a date not committed), these are the numbers to revisit.
//
// Timings of the extension's own UI (hover grace periods, the Esc Esc
// window, toast duration) are not here: they stay next to their code.

export const TIMINGS = {
  /** First try at adding the settings button, and the debounce after page changes. */
  settingsButtonFirstTry: 400,
  settingsButtonDebounce: 250,
  /** First try at adding the JSON button. */
  jsonButtonFirstTry: 1000,

  /** After the Run Test shortcut commits the focused field, before clicking Run Test. */
  runTestCommitSettle: 150,

  /** Autofill: how often to check the page for the title, and then for inputs. */
  autofillTitlePoll: 200,
  autofillInputPoll: 400,
  /** Autofill: after the inputs appear, before writing, so Angular can settle. */
  autofillSettle: 500,

  /** Waiting for a widget to react: tries × interval. */
  widgetPoll: { tries: 24, interval: 30 },
  /** Waiting for a calendar or time popup to open after a click. */
  popupPoll: { tries: 10, interval: 35 },
  /** After clicking a dropdown option, before reading the value back. */
  afterSelectOption: 60,
  /** After paging the calendar one month. */
  afterCalendarPage: 120,
  /** After clicking a day, before reading the date back. */
  afterDayClick: 80,
  /** After toggling AM/PM. */
  afterAmPmToggle: 80,
  /** After clicking away to commit the time. */
  afterTimeCommit: 40,

  /** PD Inspector: how often to check a published page for a route change. */
  pdRoutePoll: 1500
} as const;
