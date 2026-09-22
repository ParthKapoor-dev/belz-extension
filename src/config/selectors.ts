// Everything the extension looks for on the Automation Designer (AD) and Page
// Designer (PD) pages.
//
// These come from the designers' own markup, which the extension does not
// control. When a designer release breaks a feature, this is the first place
// to look. The extension's own markup (ids and classes it creates itself) is
// not listed here: it stays next to the code that creates it.
//
// A list means "try each in order, first match wins": the designers' markup
// differs between versions, and between draft and published methods.

/** The header bar at the top of both designers. */
export const HEADER = {
  banner: '.header_banner',
  /** Inside the banner; the settings button is appended here. */
  title: '.page_title'
} as const;

/** AD method page, outside the Inputs step. */
export const AD = {
  methodNameInput: 'input#SD1_MethodName',
  serviceCategory: 'div.block_sub_head',
  /** The <exp-button> host of Run Test; its inner <button> is clicked. */
  runTestButtons: [
    'exp-button#runTest',
    'exp-button.run_test_btn',
    'exp-button[aria-label="run Test"]',
    'exp-button[arialabel="run Test"]'
  ],
  outputContainer: '.output-container, .output_container'
} as const;

/** PD page and component editors. */
export const PD = {
  pageTitle: ['div.page_title', 'div.symbol_title']
} as const;

/** The Inputs step of an AD method: read by the JSON editor and autofill. */
export const AD_INPUTS = {
  /** An input's key is its element id after this prefix: INPUT_LIST_<key>. */
  keyIdPrefix: 'INPUT_LIST_',
  keyElements: '[id^="INPUT_LIST_"]',
  /** Older pages number the ids instead: INPUT_LIST<n>.<key>. */
  numberedKeyElements: '[id^="INPUT_LIST"]',
  numberedKeyId: /^INPUT_LIST\d+\.(.+)$/,
  /** Published methods have no INPUT_LIST ids; the key is a #{key} in here. */
  publishedFieldCode: '.fieldCode',
  /** Fallbacks for placing the JSON button, when no "Inputs" heading is found. */
  sectionCandidates: ['[class*="input"]', '[class*="Input"]', '[id*="input"]', '[id*="Input"]'],

  row: '.service-designer__grid-row',
  cell: '.service-designer__grid-cell',
  typeCell: '.service-designer__grid-cell._type',
  mandatoryCell: '.service-designer__grid-cell._mandatory',
  /** The nested row holding the test value (present only in Test Mode). */
  testCaseRow: '.service-designer__grid-row._test-case-row',
  /** Draft methods: the type is an editable select showing this text. */
  typeSelectText: '.ui-select-match-text',
  /** Newer UI: the type is plain text in here. */
  typeName: '.type_name',
  nameInput: 'input[placeholder="Enter Here"]',
  /** A structured-data input keeps its real value here when the main textarea shows "[object Object]". */
  structuredDefault: '.wrapper-content.textarea_outer.default_value textarea',

  /** The test-value field inside the test-case row, per input type. */
  testValue: {
    Boolean: ['.boolean_response exp-select', 'exp-select'],
    Date: ['exp-date-picker'],
    DateTime: ['exp-date-time', 'exp-date-picker'],
    File: ['input[type="file"]'],
    Number: [
      'input[type="number"]',
      'input[placeholder="Enter Here"]',
      'input.input_default',
      'input:not([type="file"]):not([type="checkbox"])'
    ],
    /** Text, Url, Json, Array, Map, StructuredData. */
    Text: [
      'textarea',
      'input[placeholder="Enter Here"]',
      'input:not([type="file"]):not([type="checkbox"])'
    ]
  }
} as const;

/** AD's custom form widgets, which the JSON editor drives by clicking. */
export const AD_WIDGETS = {
  select: {
    host: 'exp-select',
    /** The selected option's text. */
    text: '.ui-select-match-text',
    /** What to click to open the dropdown; the <exp-select> itself is the last resort. */
    triggers: ['[data-testid="select-option-wrapper-container"]', '.ui-select-container', '.select-box-text'],
    option: '.select-option-text'
  },
  datePicker: {
    host: 'exp-date-picker',
    input: 'input.datepicker_input-form',
    /** What to click to open the calendar; the picker itself is the last resort. */
    triggers: [
      '.datepicker_input-icon exp-svg-icon',
      'exp-svg-icon',
      '.datepicker_input-icon',
      'input.datepicker_input-form',
      '.datepicker_input-wrapper'
    ],
    calendar: '.calendar',
    monthLabel: '.calendar_header_month_label_text',
    nextMonth: '.calendar_header_month_navigate_next',
    prevMonth: '.calendar_header_month_navigate_prev',
    day: '.calendar_body_row_date.curr_month',
    dayValue: '.calendar_body_row_date_val'
  },
  timePicker: {
    host: 'exp-timepicker',
    triggers: ['.timepicker-placeholder', '.timepicker', '.timepicker-icon'],
    /** Hour, minute and (12-hour mode only) AM/PM, once the popup is open. */
    inputs: 'input.time_select-input',
    ampmToggle: 'exp-svg-icon.chevron, .chevron'
  }
} as const;
