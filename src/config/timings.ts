// How long the extension waits for the designer pages, in milliseconds.
//
// The designers render asynchronously (Angular), and their custom widgets
// animate open and closed. These waits were tuned by hand against the current
// AD UI: if a designer release makes a feature flaky (a dropdown option not
// found, a date not committed), these are the numbers to revisit.
//
// Timings of the extension's own UI (hover grace periods, the Esc Esc
// window, toast duration) are not here: they stay next to their code. The
// exceptions are numbers two parts of the extension must agree on
// (`panelFocusFlash`, the PD Inspector heartbeat) and the AD Network name
// lookup's retry schedule.

export const TIMINGS = {
  /** First try at adding the settings button, and the debounce after page changes. */
  settingsButtonFirstTry: 400,
  settingsButtonDebounce: 250,
  /** First try at adding the JSON button. */
  jsonButtonFirstTry: 1000,
  /**
   * After that, at most one look for the Inputs heading per this many ms,
   * however often the page changes: the search walks the page's text.
   */
  jsonButtonThrottle: 500,

  /** After the Run Test shortcut commits the focused field, before clicking Run Test. */
  runTestCommitSettle: 150,

  /** Autofill: how often to check the page for the title, and then for inputs. */
  autofillTitlePoll: 200,
  autofillInputPoll: 400,
  /** Autofill: after the inputs appear, before writing, so Angular can settle. */
  autofillSettle: 500,
  /**
   * Autofill: how long each wait (title, then inputs) lasts before giving up,
   * so a page that never renders the method does not poll forever.
   */
  autofillGiveUp: 30_000,

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

  /**
   * Rearm: when to re-attach page listeners, in ms after a feature starts,
   * spanning a slow SPA bootstrap (see designer/core/rearm.ts).
   */
  rearmDelays: [1000, 3000, 6000],

  /** PD Inspector: how often to check a published page for a route change. */
  pdRoutePoll: 1500,
  /**
   * PD Inspector inspect mode: the panel re-sends "inspect on" this often
   * while it is on, and the page engine leaves inspect mode by itself when
   * it has heard nothing for `pdInspectTimeout` (DevTools was closed, say).
   */
  pdInspectHeartbeat: 2000,
  pdInspectTimeout: 7000,

  /**
   * AD Network: retrying a method-name lookup that failed in a way that may
   * clear by itself (not signed in yet, server busy). The first retry waits
   * `first` ms, each later one twice as long up to `max`, and a uuid is given
   * up after `attempts` failed lookups.
   */
  resolveRetry: { first: 4000, max: 60_000, attempts: 5 },

  /**
   * DevTools panels: how long the focus shortcut (Ctrl+Shift+A / P) pulses
   * the panel. Shared by both panels, so it lives here rather than in either.
   * The panels' CSS animation reads it too, through the `--focus-flash-ms`
   * property FocusFlash (devtools/view.ts) sets.
   */
  panelFocusFlash: 900
} as const;
