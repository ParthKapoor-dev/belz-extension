import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { sql, keywordCompletionSource, StandardSQL } from '@codemirror/lang-sql';
import { javascript, scopeCompletionSource, localCompletionSource } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { java } from '@codemirror/lang-java';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, closeBrackets, completionKeymap } from '@codemirror/autocomplete';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  setSetting,
  subscribeSettings
} from '../../core/settings.js';
import { state } from '../../core/state.js';
import { showToast } from '../../ui/toast.js';
import { EXTENSION_OWNED_ATTR } from '../../config/constants.js';
import { lockModalInteraction, unlockModalInteraction } from '../../ui/modal-lock.js';
import { openSettingsModal } from '../settings/modal.js';
import { T, FONT_MONO, RADIUS, SHADOW, SCRIM } from '../../ui/theme.js';
import {
  MODAL_OVERLAY, MODAL_DIALOG, MODAL_HEADER, MODAL_FOOTER
} from '../../ui/modal.js';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER,
  PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER,
  applyHoverEffect
} from '../../ui/styles.js';

const OVERLAY_ID = 'sdTextareaEditorOverlay';
const TITLE_ID = 'sdTextareaEditorTitle';
const SUBTITLE_ID = 'sdTextareaEditorSubtitle';
const EDITOR_ID = 'sdTextareaEditorInput';
const EDITOR_HOST_ID = 'sdTextareaEditorHost';
const SAVE_BTN_ID = 'sdTextareaEditorSave';
const LANG_SELECT_ID = 'sdTextareaEditorLanguage';
const WRAP_SELECT_ID = 'sdTextareaEditorWrapMode';
const FONT_SIZE_SELECT_ID = 'sdTextareaEditorFontSize';
const EDITOR_SETTINGS_BUTTON_ID = 'sdTextareaEditorSettingsButton';

const EDITOR_VERTICAL_PADDING_PX = 14;
const EDITOR_HORIZONTAL_PADDING_PX = 16;
const EDITOR_FONT_FAMILY = FONT_MONO;

let editorView = null;
let resolvedEditorLanguage = 'plain';
// Set once the user picks a language by hand, which suspends detection for the
// rest of the session with that textarea. Cleared every time the editor opens,
// so detection is what you get by default, always.
let languageOverridden = false;
const languageCompartment = new Compartment();
const wrapCompartment = new Compartment();
const autocompleteCompartment = new Compartment();
let unsubscribeEditorSettings = null;

// SpEL completion source
const SPEL_KEYWORDS = [
  'and', 'or', 'not', 'eq', 'ne', 'lt', 'gt', 'le', 'ge',
  'div', 'mod', 'instanceof', 'matches', 'between',
  'true', 'false', 'null',
  'new', 'T', 'this', 'root',
];

const SPEL_BUILTINS = [
  // Common SpEL functions and properties
  'size()', 'length', 'isEmpty()', 'contains()',
  'substring()', 'toUpperCase()', 'toLowerCase()', 'trim()',
  'replace()', 'startsWith()', 'endsWith()', 'indexOf()',
  'charAt()', 'concat()', 'split()',
  'parseInt()', 'parseFloat()', 'toString()',
  'now()', 'date()', 'format()',
  // Collection methods
  'add()', 'remove()', 'get()', 'put()', 'keySet()', 'values()', 'entrySet()',
  'stream()', 'filter()', 'map()', 'collect()', 'toList()',
  // Math
  'abs()', 'ceil()', 'floor()', 'round()', 'max()', 'min()', 'random()',
];

function spelCompletionSource(context) {
  const word = context.matchBefore(/[\w.]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const options = [
    ...SPEL_KEYWORDS.map(k => ({ label: k, type: 'keyword' })),
    ...SPEL_BUILTINS.map(b => ({ label: b, type: 'function' })),
    { label: '#{}', type: 'keyword', detail: 'SpEL expression', apply: '#{${}' },
    { label: 'T()', type: 'keyword', detail: 'Type reference', apply: 'T(${}' },
  ];

  return { from: word.from, options };
}

function getAutocompleteExtensionsForMode(mode) {
  if (mode === 'sql') {
    return [
      autocompletion({
        override: [keywordCompletionSource(StandardSQL, true)]
      }),
      closeBrackets(),
    ];
  }
  if (mode === 'javascript') {
    return [
      autocompletion({
        override: [localCompletionSource, scopeCompletionSource(globalThis)]
      }),
      closeBrackets(),
    ];
  }
  if (mode === 'spel') {
    return [
      autocompletion({ override: [spelCompletionSource] }),
      closeBrackets(),
    ];
  }
  if (mode === 'json') {
    return [closeBrackets()];
  }
  if (mode === 'java' || mode === 'python') {
    // No override: the language packages register their own completion sources
    // via language data, which the default autocompletion() config picks up.
    return [autocompletion(), closeBrackets()];
  }
  return [];
}

const editorTheme = EditorView.theme(
  {
    '&, & *': {
      fontFamily: `${EDITOR_FONT_FAMILY} !important`
    },
    '&': {
      height: '100%',
      width: '100%',
      fontFamily: EDITOR_FONT_FAMILY,
      backgroundColor: 'rgba(15, 23, 42, 0.52)',
      color: T.fg
    },
    '.cm-scroller': {
      fontFamily: EDITOR_FONT_FAMILY,
      lineHeight: '1.5',
      overflowX: 'scroll',
      overflowY: 'auto'
    },
    '.cm-content': {
      fontFamily: EDITOR_FONT_FAMILY,
      caretColor: T.fg,
      padding: `${EDITOR_VERTICAL_PADDING_PX}px ${EDITOR_HORIZONTAL_PADDING_PX}px`,
      minHeight: '100%',
      letterSpacing: 'normal',
      wordSpacing: 'normal'
    },
    '.cm-line': {
      fontFamily: EDITOR_FONT_FAMILY
    },
    '.cm-gutters': {
      fontFamily: EDITOR_FONT_FAMILY,
      backgroundColor: 'rgba(15, 23, 42, 0.7)',
      color: T.fgFaint,
      borderRight: '1px solid rgba(148, 163, 184, 0.2)'
    },
    '.cm-lineNumbers .cm-gutterElement': {
      fontFamily: EDITOR_FONT_FAMILY,
      minWidth: '44px',
      padding: '0 10px 0 0',
      textAlign: 'right'
    },
    '&.cm-focused': {
      outline: 'none'
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: T.fg
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(96, 165, 250, 0.35)'
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(148, 163, 184, 0.13)'
    },
    '.cm-panels': {
      backgroundColor: 'rgba(15, 23, 42, 0.96)',
      borderTop: '1px solid rgba(148, 163, 184, 0.2)',
      color: T.fg
    },
    '.cm-search': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap',
      padding: '6px 10px'
    },
    '.cm-search input': {
      fontFamily: EDITOR_FONT_FAMILY,
      fontSize: '12px',
      background: 'rgba(30, 41, 59, 0.9)',
      color: T.fg,
      border: '1px solid rgba(148, 163, 184, 0.35)',
      borderRadius: RADIUS,
      padding: '4px 8px',
      outline: 'none'
    },
    '.cm-search input:focus': {
      borderColor: 'rgba(96, 165, 250, 0.6)',
      boxShadow: '0 0 0 2px rgba(96, 165, 250, 0.15)'
    },
    '.cm-search button': {
      fontFamily: EDITOR_FONT_FAMILY,
      fontSize: '12px',
      background: 'rgba(37, 99, 235, 0.2)',
      color: T.accent,
      border: '1px solid rgba(59, 130, 246, 0.35)',
      borderRadius: RADIUS,
      padding: '4px 10px',
      cursor: 'pointer'
    },
    '.cm-search button:hover': {
      background: 'rgba(37, 99, 235, 0.35)',
      borderColor: 'rgba(96, 165, 250, 0.55)'
    },
    '.cm-search button[name=close]': {
      background: 'rgba(248, 113, 113, 0.12)',
      color: T.danger,
      border: '1px solid rgba(248, 113, 113, 0.35)',
      borderRadius: RADIUS,
      padding: '4px 8px',
      fontSize: '14px',
      lineHeight: '1'
    },
    '.cm-search button[name=close]:hover': {
      background: 'rgba(248, 113, 113, 0.25)',
      borderColor: 'rgba(248, 113, 113, 0.55)'
    },
    '.cm-search label': {
      fontSize: '12px',
      color: T.fgMuted,
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      cursor: 'pointer',
      userSelect: 'none'
    },
    '.cm-search .cm-textfield': {
      minWidth: '180px'
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(250, 204, 21, 0.25)',
      outline: '1px solid rgba(250, 204, 21, 0.5)'
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(250, 204, 21, 0.5)',
      outline: '1px solid rgba(250, 204, 21, 0.8)'
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      fontFamily: EDITOR_FONT_FAMILY,
      background: 'rgba(15, 23, 42, 0.96)',
      border: '1px solid rgba(148, 163, 184, 0.3)',
      borderRadius: RADIUS,
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
      overflow: 'hidden'
    },
    '.cm-tooltip-autocomplete ul': {
      fontFamily: EDITOR_FONT_FAMILY,
      maxHeight: '200px'
    },
    '.cm-tooltip-autocomplete ul li': {
      fontFamily: EDITOR_FONT_FAMILY,
      padding: '4px 10px',
      color: T.fg,
      fontSize: '13px',
      lineHeight: '1.5'
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      background: 'rgba(37, 99, 235, 0.35)',
      color: T.fg
    },
    '.cm-completionLabel': {
      fontFamily: EDITOR_FONT_FAMILY
    },
    '.cm-completionDetail': {
      fontFamily: EDITOR_FONT_FAMILY,
      color: T.fgFaint,
      fontStyle: 'italic',
      marginLeft: '8px'
    },
    '.cm-completionMatchedText': {
      color: T.accent,
      textDecoration: 'none',
      fontWeight: '600'
    }
  },
  { dark: true }
);

function destroyEditorView() {
  if (!editorView) return;
  editorView.destroy();
  editorView = null;
}

function getEditorText() {
  if (!editorView) return '';
  return editorView.state.doc.toString();
}

function getSelectedFontSize() {
  const fontSizeSelect = document.getElementById(FONT_SIZE_SELECT_ID);
  const value = Number.parseInt(fontSizeSelect?.value || '13', 10);
  if (Number.isFinite(value) && [12, 13, 14, 16, 18].includes(value)) {
    return value;
  }
  return 13;
}

function getSelectedWrapMode() {
  const wrapSelect = document.getElementById(WRAP_SELECT_ID);
  return wrapSelect?.value || DEFAULT_SETTINGS.textareaEditorWrap;
}

function getEditorSettings() {
  const settings = loadSettings();
  return {
    wrap: settings.textareaEditorWrap || DEFAULT_SETTINGS.textareaEditorWrap,
    fontSize: Number.parseInt(String(settings.textareaEditorFontSize || 13), 10) || 13
  };
}

function syncEditorControlValuesFromSettings() {
  const settings = getEditorSettings();
  const wrapSelect = document.getElementById(WRAP_SELECT_ID);
  const fontSizeSelect = document.getElementById(FONT_SIZE_SELECT_ID);

  if (wrapSelect && wrapSelect.value !== settings.wrap) {
    wrapSelect.value = settings.wrap;
  }
  if (fontSizeSelect) {
    const nextFontValue = String(settings.fontSize);
    if (fontSizeSelect.value !== nextFontValue) {
      fontSizeSelect.value = nextFontValue;
    }
  }
}

function openMainSettingsFromEditor() {
  openSettingsModal({
    getSettings: loadSettings,
    setSetting
  });
}

function applyEditorFontSize(fontSize) {
  if (!editorView) return;
  const fontSizePx = `${fontSize}px`;
  editorView.dom.style.fontSize = fontSizePx;
  editorView.dom.style.fontFamily = EDITOR_FONT_FAMILY;
  editorView.dom.style.letterSpacing = 'normal';
  editorView.dom.style.wordSpacing = 'normal';
}

// Every mode the editor can be in. There is no 'auto' entry: the dropdown
// reports the detected mode by name, and selecting an entry overrides it.
const LANGUAGE_OPTIONS = [
  { value: 'sql', label: 'SQL' },
  { value: 'spel', label: 'SpEL' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'java', label: 'Java' },
  { value: 'python', label: 'Python' },
  { value: 'plain', label: 'Plain' }
];

// ---- language detection ---------------------------------------------------
// The editor has no "auto" mode any more: detection always runs, and the header
// dropdown reports what it found. Picking from the dropdown overrides the
// detector until the editor is closed and reopened.

// A SQL statement, judged by how it OPENS rather than by any keyword appearing
// somewhere in it — `from` and `where` turn up in prose and SpEL alike.
const SQL_STATEMENT_RE =
  /^\s*(?:with|select|insert\s+into|update|delete\s+from|merge|replace\s+into|create|alter|drop|truncate)\b/i;
// A SELECT ... FROM pair anywhere, for fragments that do not open cleanly —
// a leading comment, or a snippet pasted from the middle of a statement.
const SQL_SHAPE_RE = /\bselect\b[\s\S]*\bfrom\b/i;

// SpEL, identified only by constructs unique to it: an interpolation block or
// a T() type reference. An earlier detector also accepted the bare words
// and/or/not/eq/ne/lt/gt/le/ge, which match ordinary SQL and English — a plain
// `a = 1 and b = 2` was enough to be called SpEL.
const SPEL_RE = /#\{[\s\S]*?\}|\bT\(\s*[\w.$]+\s*\)/;

// Java, by constructs JavaScript cannot produce: a `package`/`import` line
// terminated with a semicolon (JS imports quote their source), an access
// modifier introducing a member, an annotation, or System.out.
const JAVA_RE = new RegExp([
  /^\s*package\s+[\w.]+\s*;/.source,
  /^\s*import\s+(?:static\s+)?[\w.]+(?:\.\*)?\s*;/.source,
  /^\s*@(?:Override|Test|Autowired|Component|Service|Entity|SpringBootApplication|FunctionalInterface)\b/.source,
  /\b(?:public|private|protected)\s+(?:static\s+|final\s+|abstract\s+|synchronized\s+)*(?:class|interface|enum|record|void|int|long|double|float|boolean|char|byte|short|String|List<|Map<|[A-Z][\w.]*(?:<[^>\n]*>)?(?:\[\])?)\s+\w+/.source,
  /\bSystem\.(?:out|err)\.print/.source
].join('|'), 'm');

// Python, by its block syntax and its own keywords. `def name(...):` and a
// dedicated `elif` have no JavaScript equivalent.
const PYTHON_RE = new RegExp([
  /^\s*(?:async\s+)?def\s+\w+\s*\([^\n]*\)\s*(?:->[^:\n]+)?:/.source,
  /^\s*class\s+\w+\s*(?:\([^\n]*\))?\s*:\s*$/.source,
  /^\s*from\s+[\w.]+\s+import\s+\w/.source,
  /^\s*(?:if|elif|for|while|with|try|except|finally|else)\b[^\n]*:\s*(?:#[^\n]*)?$/.source,
  /\belif\b/.source,
  /__name__|__init__|\bself\.\w/.source
].join('|'), 'm');

const JS_RE =
  /\b(?:const|let|var|function|return|class|import|export|async|await)\b|=>|console\./;

// JSON is bracket-delimited with a MATCHING closer — `{ ... ]` is neither a
// JSON object nor an array, so the pair is checked rather than "starts with one
// of {[ and ends with one of }]".
function looksLikeJson(sample) {
  const opener = sample[0];
  const closer = sample[sample.length - 1];
  const paired =
    (opener === '{' && closer === '}') || (opener === '[' && closer === ']');
  if (!paired) return false;

  try {
    JSON.parse(sample);
    return true;
  } catch {
    // A document being typed or repaired — a trailing comma, an unclosed
    // string, a single-quoted key — does not parse but is still JSON as far as
    // the person editing it is concerned, and highlighting it as anything else
    // is worse than useless. Require some structural evidence, so a random
    // `{...}` block of prose stays plain.
    return (
      /["']\s*:/.test(sample) // "key": ... (or a single-quoted key)
      || /^[[{]\s*[\]}]$/.test(sample) // {} / []
      || /^\[\s*[[{"]/.test(sample) // array of objects / arrays / strings
      || /^\[\s*-?\d/.test(sample) // array of numbers
    );
  }
}

function detectLanguage(text) {
  const sample = text.trim();
  if (!sample) return 'plain';

  if (looksLikeJson(sample)) return 'json';

  // SQL is tested BEFORE SpEL on purpose. Automation Designer SQL steps
  // routinely interpolate SpEL placeholders —
  //   select id from guardian where account_id = '#{userIdMetaDb}'
  // — and testing SpEL first meant every such statement was highlighted as
  // SpEL. A statement that opens as SQL is SQL, whatever it interpolates.
  if (SQL_STATEMENT_RE.test(sample) || SQL_SHAPE_RE.test(sample)) {
    return 'sql';
  }

  // Java before SpEL: SpEL's `T(java.lang.Math)` shares vocabulary with Java,
  // but a Java source file also carries package/modifier/annotation syntax that
  // a SpEL expression never does.
  if (JAVA_RE.test(sample)) return 'java';

  if (SPEL_RE.test(sample)) return 'spel';

  // Python before JavaScript: both use `class`, `import` and `return`, so the
  // Python patterns (which are colon-terminated blocks and Python-only
  // keywords) get first refusal.
  if (PYTHON_RE.test(sample)) return 'python';

  if (JS_RE.test(sample)) return 'javascript';

  return 'plain';
}

function getLanguageExtensionForMode(mode) {
  if (mode === 'sql') return sql();
  if (mode === 'javascript') return javascript();
  if (mode === 'json') return json();
  if (mode === 'java') return java();
  if (mode === 'python') return python();
  // SpEL has no grammar of its own; JavaScript's is the closest fit for its
  // dotted paths, string literals and call syntax.
  if (mode === 'spel') return javascript();
  return [];
}

function syncLanguageSelectValue(mode) {
  const languageSelect = document.getElementById(LANG_SELECT_ID);
  if (languageSelect && languageSelect.value !== mode) {
    languageSelect.value = mode;
  }
}

function reconfigureEditorLanguage(mode) {
  if (!editorView) return;
  resolvedEditorLanguage = mode;
  syncLanguageSelectValue(mode);
  editorView.dispatch({
    effects: [
      languageCompartment.reconfigure(getLanguageExtensionForMode(mode)),
      autocompleteCompartment.reconfigure(getAutocompleteExtensionsForMode(mode))
    ]
  });
}

function getWrapExtensionForMode(mode) {
  if (mode === 'wrap') {
    return [
      EditorView.lineWrapping,
      EditorView.theme({
        '.cm-scroller': {
          overflowX: 'hidden'
        },
        '.cm-lineWrapping': {
          whiteSpace: 'break-spaces',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word'
        }
      })
    ];
  }

  return [
    EditorView.theme({
      '.cm-scroller': {
        overflowX: 'scroll'
      },
      '.cm-content': {
        whiteSpace: 'pre',
        overflowWrap: 'normal',
        wordBreak: 'normal'
      }
    })
  ];
}

function reconfigureEditorWrapMode(mode) {
  if (!editorView) return;
  editorView.dispatch({
    effects: wrapCompartment.reconfigure(getWrapExtensionForMode(mode))
  });
}

function createEditorForSource(sourceEl) {
  const host = document.getElementById(EDITOR_HOST_ID);
  if (!host) return;

  const textValue = sourceEl.value || '';
  const readOnly = sourceEl.readOnly || sourceEl.disabled;
  const selectedWrapMode = getSelectedWrapMode();
  // Every open re-detects. A manual pick from the previous open does not carry
  // over — otherwise one override would silently mislabel every later step.
  const initialLanguageMode = detectLanguage(textValue);
  resolvedEditorLanguage = initialLanguageMode;
  languageOverridden = false;
  syncLanguageSelectValue(initialLanguageMode);

  const extensions = [
    lineNumbers(),
    history(),
    highlightActiveLine(),
    search({ top: false }),
    keymap.of([...completionKeymap, ...searchKeymap, indentWithTab, ...defaultKeymap]),
    EditorState.tabSize.of(4),
    EditorState.readOnly.of(readOnly),
    editorTheme,
    oneDark,
    languageCompartment.of(getLanguageExtensionForMode(initialLanguageMode)),
    autocompleteCompartment.of(getAutocompleteExtensionsForMode(initialLanguageMode)),
    wrapCompartment.of(getWrapExtensionForMode(selectedWrapMode)),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || !editorView) return;
      if (languageOverridden) return;

      const nextMode = detectLanguage(update.state.doc.toString());
      if (nextMode === resolvedEditorLanguage) return;
      reconfigureEditorLanguage(nextMode);
    })
  ];

  destroyEditorView();
  editorView = new EditorView({
    state: EditorState.create({
      doc: textValue,
      selection: { anchor: textValue.length },
      extensions
    }),
    parent: host
  });

  applyEditorFontSize(getSelectedFontSize());
}

function handleLanguageSelectionChange() {
  if (!editorView) return;

  const languageSelect = document.getElementById(LANG_SELECT_ID);
  const selectedMode = languageSelect?.value;
  if (!selectedMode) return;

  // Deliberately not persisted: the mode belongs to the text, not to the user.
  languageOverridden = true;
  reconfigureEditorLanguage(selectedMode);
}

function handleWrapSelectionChange() {
  if (!editorView) return;
  const wrapMode = getSelectedWrapMode();
  setSetting('textareaEditorWrap', wrapMode);
  reconfigureEditorWrapMode(wrapMode);
}

function handleFontSizeSelectionChange() {
  const fontSize = getSelectedFontSize();
  setSetting('textareaEditorFontSize', fontSize);
  applyEditorFontSize(fontSize);
}

function applyEditorSettingsFromStore(settings) {
  syncEditorControlValuesFromSettings();
  if (!editorView) return;

  // Language is not a stored setting — it is detected, or overridden in the
  // header — so a settings change never touches it.
  reconfigureEditorWrapMode(
    settings.textareaEditorWrap || DEFAULT_SETTINGS.textareaEditorWrap
  );
  applyEditorFontSize(
    Number.parseInt(String(settings.textareaEditorFontSize || 13), 10) || 13
  );
}

function ensureEditorSettingsSubscription() {
  if (unsubscribeEditorSettings) return;

  unsubscribeEditorSettings = subscribeSettings((settings) => {
    if (!state.textareaEditorModalEl) return;
    applyEditorSettingsFromStore(settings);
  });
}

export function closeTextareaEditor() {
  if (!state.textareaEditorModalEl || state.textareaEditorModalEl.style.display === 'none') return;
  state.textareaEditorModalEl.style.display = 'none';
  state.textareaEditorSourceEl = null;
  destroyEditorView();
  unlockModalInteraction();
}

function syncSourceTextarea(sourceEl, value) {
  sourceEl.value = value;
  sourceEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  sourceEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

async function copyEditorText() {
  const text = getEditorText();
  if (!text.trim()) {
    showToast('Nothing to copy');
    return;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied editor text');
      return;
    } catch (error) {
      // fall through to execCommand fallback
      console.error('Navigator clipboard copy failed:', error);
    }
  }

  const tempTextarea = document.createElement('textarea');
  tempTextarea.value = text;
  tempTextarea.setAttribute('readonly', '');
  tempTextarea.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  Object.assign(tempTextarea.style, {
    position: 'fixed',
    top: '-1000px',
    left: '-1000px',
    opacity: '0'
  });

  document.body.appendChild(tempTextarea);
  tempTextarea.select();
  tempTextarea.setSelectionRange(0, tempTextarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    console.error('Fallback clipboard copy failed:', error);
  }

  tempTextarea.remove();
  showToast(copied ? 'Copied editor text' : 'Failed to copy');
}

function handleSave() {
  const sourceEl = state.textareaEditorSourceEl;
  const saveBtn = document.getElementById(SAVE_BTN_ID);

  if (!sourceEl || !saveBtn || saveBtn.disabled || !editorView) {
    return;
  }

  syncSourceTextarea(sourceEl, getEditorText());
  showToast('Textarea updated');
  closeTextareaEditor();
}

function describeSource(textarea) {
  const label = textarea.getAttribute('aria-label')
    || textarea.getAttribute('name')
    || textarea.id
    || textarea.getAttribute('placeholder')
    || 'textarea';

  return `Editing: ${label}`;
}

function updateModalForSource(sourceEl) {
  const title = document.getElementById(TITLE_ID);
  const subtitle = document.getElementById(SUBTITLE_ID);
  const saveBtn = document.getElementById(SAVE_BTN_ID);

  if (!title || !subtitle || !saveBtn) return;

  const readOnly = sourceEl.readOnly || sourceEl.disabled;

  title.textContent = 'Large Text Editor';
  subtitle.textContent = readOnly
    ? `${describeSource(sourceEl)} (read only)`
    : describeSource(sourceEl);

  saveBtn.disabled = readOnly;
  saveBtn.style.opacity = readOnly ? '0.45' : '1';
  saveBtn.style.cursor = readOnly ? 'not-allowed' : 'pointer';

  syncEditorControlValuesFromSettings();
  createEditorForSource(sourceEl);
}

function attachGlobalShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (!state.textareaEditorModalEl || state.textareaEditorModalEl.style.display !== 'flex') {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeTextareaEditor();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      handleSave();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      if (editorView) {
        openSearchPanel(editorView);
        requestAnimationFrame(() => {
          const searchInput = editorView.dom.querySelector('.cm-search input');
          if (searchInput) searchInput.focus();
        });
      }
    }
  }, true);
}

export function createTextareaEditorModal() {
  if (state.textareaEditorModalEl) return state.textareaEditorModalEl;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  Object.assign(overlay.style, MODAL_OVERLAY, {
    zIndex: '999997',
    padding: '12px'
  });

  const dialog = document.createElement('div');
  Object.assign(dialog.style, MODAL_DIALOG, {
    width: 'calc(100vw - 24px)',
    height: 'calc(100vh - 24px)',
    maxWidth: 'none',
    maxHeight: 'none'
  });

  const header = document.createElement('div');
  Object.assign(header.style, MODAL_HEADER);

  const titleWrap = document.createElement('div');
  const title = document.createElement('h2');
  title.id = TITLE_ID;
  title.textContent = 'Large Text Editor';
  Object.assign(title.style, {
    margin: '0',
    fontSize: '16px',
    color: T.fg
  });

  const subtitle = document.createElement('div');
  subtitle.id = SUBTITLE_ID;
  subtitle.textContent = 'Editing';
  Object.assign(subtitle.style, {
    marginTop: '4px',
    fontSize: '12px',
    color: T.fgMuted
  });

  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);

  const headerActions = document.createElement('div');
  Object.assign(headerActions.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  });

  const fontSizeSelect = document.createElement('select');
  fontSizeSelect.id = FONT_SIZE_SELECT_ID;
  Object.assign(fontSizeSelect.style, {
    background: 'rgba(15, 23, 42, 0.75)',
    color: T.fgMuted,
    border: '1px solid rgba(148, 163, 184, 0.4)',
    borderRadius: RADIUS,
    padding: '4px 8px',
    fontSize: '12px',
    outline: 'none',
    cursor: 'pointer'
  });
  const fontOptions = ['12', '13', '14', '16', '18'];
  for (const optionValue of fontOptions) {
    const optionEl = document.createElement('option');
    optionEl.value = optionValue;
    optionEl.textContent = `${optionValue}px`;
    if (optionValue === '13') optionEl.selected = true;
    fontSizeSelect.appendChild(optionEl);
  }

  const wrapSelect = document.createElement('select');
  wrapSelect.id = WRAP_SELECT_ID;
  Object.assign(wrapSelect.style, {
    background: 'rgba(15, 23, 42, 0.75)',
    color: T.fgMuted,
    border: '1px solid rgba(148, 163, 184, 0.4)',
    borderRadius: RADIUS,
    padding: '4px 8px',
    fontSize: '12px',
    outline: 'none',
    cursor: 'pointer'
  });
  const wrapOptions = [
    { value: 'nowrap', label: 'No Wrap' },
    { value: 'wrap', label: 'Wrap' }
  ];
  for (const option of wrapOptions) {
    const optionEl = document.createElement('option');
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    if (option.value === DEFAULT_SETTINGS.textareaEditorWrap) optionEl.selected = true;
    wrapSelect.appendChild(optionEl);
  }

  const languageSelect = document.createElement('select');
  languageSelect.id = LANG_SELECT_ID;
  Object.assign(languageSelect.style, {
    background: 'rgba(15, 23, 42, 0.75)',
    color: T.fgMuted,
    border: '1px solid rgba(148, 163, 184, 0.4)',
    borderRadius: RADIUS,
    padding: '4px 8px',
    fontSize: '12px',
    outline: 'none',
    cursor: 'pointer'
  });
  languageSelect.setAttribute(
    'title',
    'Detected syntax mode — pick another to override it for this editor session'
  );
  for (const option of LANGUAGE_OPTIONS) {
    const optionEl = document.createElement('option');
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    if (option.value === 'plain') optionEl.selected = true;
    languageSelect.appendChild(optionEl);
  }

  const settingsBtn = document.createElement('button');
  settingsBtn.id = EDITOR_SETTINGS_BUTTON_ID;
  settingsBtn.type = 'button';
  settingsBtn.textContent = '⚙';
  settingsBtn.setAttribute('title', 'Open extension settings');
  settingsBtn.setAttribute('aria-label', 'Open extension settings');
  Object.assign(settingsBtn.style, {
    width: '30px',
    height: '30px',
    padding: '0',
    borderRadius: RADIUS,
    border: '1px solid rgba(59, 130, 246, 0.45)',
    background: T.accent,
    color: T.fg,
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 10px rgba(37, 99, 235, 0.3)',
    lineHeight: '1'
  });
  settingsBtn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMainSettingsFromEditor();
  };

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy';
  copyBtn.setAttribute('title', 'Copy editor text');
  Object.assign(copyBtn.style, {
    border: '1px solid rgba(148, 163, 184, 0.45)',
    background: 'rgba(15, 23, 42, 0.75)',
    color: T.fgMuted,
    borderRadius: RADIUS,
    padding: '4px 10px',
    fontSize: '12px',
    cursor: 'pointer'
  });
  copyBtn.onclick = () => {
    copyEditorText();
  };

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close large text editor');
  Object.assign(closeBtn.style, {
    width: '30px',
    height: '30px',
    borderRadius: RADIUS,
    border: '1px solid rgba(248, 113, 113, 0.45)',
    background: 'rgba(248, 113, 113, 0.15)',
    color: T.danger,
    fontSize: '20px',
    cursor: 'pointer',
    lineHeight: '1'
  });
  closeBtn.onclick = closeTextareaEditor;

  header.appendChild(titleWrap);
  headerActions.appendChild(languageSelect);
  headerActions.appendChild(wrapSelect);
  headerActions.appendChild(fontSizeSelect);
  headerActions.appendChild(settingsBtn);
  headerActions.appendChild(copyBtn);
  headerActions.appendChild(closeBtn);
  header.appendChild(headerActions);

  const body = document.createElement('div');
  Object.assign(body.style, {
    display: 'flex',
    flex: '1',
    minHeight: '0'
  });

  const editorHost = document.createElement('div');
  editorHost.id = EDITOR_HOST_ID;
  editorHost.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  Object.assign(editorHost.style, {
    display: 'flex',
    flex: '1',
    minHeight: '0'
  });

  body.appendChild(editorHost);

  const footer = document.createElement('div');
  Object.assign(footer.style, MODAL_FOOTER);

  const helper = document.createElement('div');
  helper.textContent = 'Syntax highlighting and optional line wrapping.';
  Object.assign(helper.style, {
    color: T.fgFaint,
    fontSize: '12px'
  });

  const buttonGroup = document.createElement('div');
  Object.assign(buttonGroup.style, {
    display: 'flex',
    gap: '8px'
  });

  const TEXT_BTN = { width: 'auto', height: 'auto', padding: '7px 16px', fontSize: '13px' };

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, ICON_BUTTON_STYLE, TEXT_BTN);
  applyHoverEffect(cancelBtn, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER);
  cancelBtn.onclick = closeTextareaEditor;

  const saveBtn = document.createElement('button');
  saveBtn.id = SAVE_BTN_ID;
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  Object.assign(saveBtn.style, PRIMARY_BUTTON_STYLE, TEXT_BTN);
  applyHoverEffect(saveBtn, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER);
  saveBtn.onclick = handleSave;

  buttonGroup.appendChild(cancelBtn);
  buttonGroup.appendChild(saveBtn);
  footer.appendChild(helper);
  footer.appendChild(buttonGroup);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeTextareaEditor();
    }
  });

  document.body.appendChild(overlay);
  state.textareaEditorModalEl = overlay;
  attachGlobalShortcuts();
  ensureEditorSettingsSubscription();
  languageSelect.addEventListener('change', handleLanguageSelectionChange);
  wrapSelect.addEventListener('change', handleWrapSelectionChange);
  fontSizeSelect.addEventListener('change', handleFontSizeSelectionChange);
  syncEditorControlValuesFromSettings();

  return state.textareaEditorModalEl;
}

export function openTextareaEditor(sourceEl) {
  if (!sourceEl) return;

  const modal = createTextareaEditorModal();
  const wasOpen = modal.style.display === 'flex';
  state.textareaEditorSourceEl = sourceEl;
  updateModalForSource(sourceEl);
  modal.style.display = 'flex';
  if (!wasOpen) {
    lockModalInteraction();
  }

  if (editorView) {
    editorView.focus();
  }
}
