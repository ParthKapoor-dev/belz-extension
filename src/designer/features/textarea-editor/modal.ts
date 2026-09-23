/*! belz-singleton: designer/features/textarea-editor/modal */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
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
import { settings } from '../../core/settings';
import {
  SETTINGS,
  sanitizeSetting,
  type EditorFontSize,
  type Settings,
  type WrapMode
} from '../../../config/settings';
import { toast } from '../../ui/toast';
import { EXTENSION_OWNED_ATTR, ns } from '../../../config/namespace';
import { modalLock } from '../../ui/modal-lock';
import { settingsModal } from '../settings/modal';
import { T, FONT_MONO, RADIUS } from '../../ui/theme';
import {
  MODAL_OVERLAY, MODAL_DIALOG, MODAL_HEADER, MODAL_FOOTER
} from '../../ui/modal';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER,
  PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER,
  applyHoverEffect
} from '../../ui/styles';
import { LANGUAGE_OPTIONS, detectLanguage, type LanguageMode } from './language';
import { copyText } from '../../utils/clipboard';
import type { Extension } from '@codemirror/state';
import type { CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { variableCompletionSource, variableExtensions } from './variables';
import { scopeStatus } from './references';
import type { VariableScope } from './scope';

const OVERLAY_ID = ns('TextareaEditorOverlay');
const TITLE_ID = ns('TextareaEditorTitle');
const SUBTITLE_ID = ns('TextareaEditorSubtitle');
const EDITOR_HOST_ID = ns('TextareaEditorHost');
const SAVE_BTN_ID = ns('TextareaEditorSave');
const LANG_SELECT_ID = ns('TextareaEditorLanguage');
const WRAP_SELECT_ID = ns('TextareaEditorWrapMode');
const FONT_SIZE_SELECT_ID = ns('TextareaEditorFontSize');
const EDITOR_SETTINGS_BUTTON_ID = ns('TextareaEditorSettingsButton');
const STATUS_ID = ns('TextareaEditorStatus');

const DEFAULT_STATUS = 'Syntax highlighting and optional line wrapping.';

const EDITOR_VERTICAL_PADDING_PX = 14;
const EDITOR_HORIZONTAL_PADDING_PX = 16;
const EDITOR_FONT_FAMILY = FONT_MONO;

/** One of the modal's own elements, by id (they exist once the modal is built). */
function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

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

function spelCompletionSource(context: CompletionContext): CompletionResult | null {
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

/**
 * Completion for a mode. `variables`, when the page supplied a scope, is
 * listed first in every mode: prepended to an override list, or added as
 * language data where the language's own sources come from language data.
 */
function getAutocompleteExtensionsForMode(mode: LanguageMode, variables: CompletionSource | null): Extension[] {
  const extra = variables ? [variables] : [];
  if (mode === 'sql') {
    return [
      autocompletion({
        override: [...extra, keywordCompletionSource(StandardSQL, true)]
      }),
      closeBrackets(),
    ];
  }
  if (mode === 'javascript') {
    return [
      autocompletion({
        override: [...extra, localCompletionSource, scopeCompletionSource(globalThis)]
      }),
      closeBrackets(),
    ];
  }
  if (mode === 'spel') {
    return [
      autocompletion({ override: [...extra, spelCompletionSource] }),
      closeBrackets(),
    ];
  }
  if (mode === 'java' || mode === 'python') {
    // No override: the language packages register their own completion sources
    // via language data, which the default autocompletion() config picks up.
    return [
      autocompletion(),
      closeBrackets(),
      ...extra.map((source) => EditorState.languageData.of(() => [{ autocomplete: source }]))
    ];
  }
  // json and plain have no completion of their own.
  const completion = extra.length ? [autocompletion({ override: extra })] : [];
  return mode === 'json' ? [...completion, closeBrackets()] : completion;
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


/** A setting's options as <option>s, its default selected. */
function appendOptions(
  select: HTMLSelectElement,
  spec: { default: string | number; options: ReadonlyArray<{ value: string | number; label: string }> }
): void {
  for (const option of spec.options) {
    const optionEl = document.createElement('option');
    optionEl.value = String(option.value);
    optionEl.textContent = option.label;
    optionEl.selected = option.value === spec.default;
    select.appendChild(optionEl);
  }
}


function getSelectedFontSize(): EditorFontSize {
  return sanitizeSetting('textareaEditorFontSize', byId<HTMLSelectElement>(FONT_SIZE_SELECT_ID)?.value);
}

function getSelectedWrapMode(): WrapMode {
  return sanitizeSetting('textareaEditorWrap', byId<HTMLSelectElement>(WRAP_SELECT_ID)?.value);
}

function getEditorSettings(): { wrap: WrapMode; fontSize: EditorFontSize } {
  const current = settings.get();
  return { wrap: current.textareaEditorWrap, fontSize: current.textareaEditorFontSize };
}

function syncEditorControlValuesFromSettings(): void {
  const editor = getEditorSettings();
  const wrapSelect = byId<HTMLSelectElement>(WRAP_SELECT_ID);
  const fontSizeSelect = byId<HTMLSelectElement>(FONT_SIZE_SELECT_ID);

  if (wrapSelect && wrapSelect.value !== editor.wrap) {
    wrapSelect.value = editor.wrap;
  }
  if (fontSizeSelect) {
    const nextFontValue = String(editor.fontSize);
    if (fontSizeSelect.value !== nextFontValue) {
      fontSizeSelect.value = nextFontValue;
    }
  }
}


function getLanguageExtensionForMode(mode: LanguageMode): Extension {
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

function syncLanguageSelectValue(mode: LanguageMode): void {
  const languageSelect = byId<HTMLSelectElement>(LANG_SELECT_ID);
  if (languageSelect && languageSelect.value !== mode) {
    languageSelect.value = mode;
  }
}


function getWrapExtensionForMode(mode: WrapMode): Extension[] {
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









function syncSourceTextarea(sourceEl: HTMLTextAreaElement, value: string): void {
  sourceEl.value = value;
  sourceEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  sourceEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}



function describeSource(textarea: HTMLTextAreaElement): string {
  const label = textarea.getAttribute('aria-label')
    || textarea.getAttribute('name')
    || textarea.id
    || textarea.getAttribute('placeholder')
    || 'textarea';

  return `Editing: ${label}`;
}

export class TextareaEditorModal {
  private overlay: HTMLDivElement | null = null;
  /** The page textarea being edited. */
  private source: HTMLTextAreaElement | null = null;
  private view: EditorView | null = null;
  private language: LanguageMode = 'plain';
  /**
   * The user picked a language in the header, so stop re-detecting it as they
   * type. Reset on every open.
   */
  private languageOverridden = false;
  private readonly languageCompartment = new Compartment();
  private readonly wrapCompartment = new Compartment();
  private readonly autocompleteCompartment = new Compartment();
  /** The variables in scope for this open, read once by the page's scope provider. */
  private scope: VariableScope | null = null;
  /** Completion over `scope`, built once per open and reused on mode changes. */
  private variableSource: CompletionSource | null = null;
  private unsubscribeSettings: (() => void) | null = null;

  private destroyView(): void {
    if (!this.view) return;
    this.view.destroy();
    this.view = null;
  }

  private text(): string {
    if (!this.view) return '';
    return this.view.state.doc.toString();
  }

  private applyFontSize(fontSize: number): void {
    if (!this.view) return;
    const fontSizePx = `${fontSize}px`;
    this.view.dom.style.fontSize = fontSizePx;
    this.view.dom.style.fontFamily = EDITOR_FONT_FAMILY;
    this.view.dom.style.letterSpacing = 'normal';
    this.view.dom.style.wordSpacing = 'normal';
  }

  private setLanguage(mode: LanguageMode): void {
    if (!this.view) return;
    this.language = mode;
    syncLanguageSelectValue(mode);
    this.view.dispatch({
      effects: [
        this.languageCompartment.reconfigure(getLanguageExtensionForMode(mode)),
        this.autocompleteCompartment.reconfigure(getAutocompleteExtensionsForMode(mode, this.variableSource))
      ]
    });
  }

  private setWrapMode(mode: WrapMode): void {
    if (!this.view) return;
    this.view.dispatch({
      effects: this.wrapCompartment.reconfigure(getWrapExtensionForMode(mode))
    });
  }

  private createView(sourceEl: HTMLTextAreaElement): void {
    const host = byId<HTMLElement>(EDITOR_HOST_ID);
    if (!host) return;

    const textValue = sourceEl.value || '';
    const readOnly = sourceEl.readOnly || sourceEl.disabled;
    const selectedWrapMode = getSelectedWrapMode();
    // Every open re-detects. A manual pick from the previous open does not carry
    // over — otherwise one override would silently mislabel every later step.
    const initialLanguageMode = detectLanguage(textValue);
    this.language = initialLanguageMode;
    this.languageOverridden = false;
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
      this.languageCompartment.of(getLanguageExtensionForMode(initialLanguageMode)),
      this.autocompleteCompartment.of(getAutocompleteExtensionsForMode(initialLanguageMode, this.variableSource)),
      this.scope ? variableExtensions(this.scope) : [],
      this.wrapCompartment.of(getWrapExtensionForMode(selectedWrapMode)),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || !this.view) return;
        if (this.languageOverridden) return;

        const nextMode = detectLanguage(update.state.doc.toString());
        if (nextMode === this.language) return;
        this.setLanguage(nextMode);
      })
    ];

    this.destroyView();
    this.view = new EditorView({
      state: EditorState.create({
        doc: textValue,
        selection: { anchor: textValue.length },
        extensions
      }),
      parent: host
    });

    this.applyFontSize(getSelectedFontSize());
  }

  private onLanguagePicked(): void {
    if (!this.view) return;

    const languageSelect = byId<HTMLSelectElement>(LANG_SELECT_ID);
    const selectedMode = languageSelect?.value as LanguageMode | undefined;
    if (!selectedMode) return;

    // Deliberately not persisted: the mode belongs to the text, not to the user.
    this.languageOverridden = true;
    this.setLanguage(selectedMode);
  }

  private onWrapPicked(): void {
    if (!this.view) return;
    const wrapMode = getSelectedWrapMode();
    settings.set('textareaEditorWrap', wrapMode);
    this.setWrapMode(wrapMode);
  }

  private onFontSizePicked(): void {
    const fontSize = getSelectedFontSize();
    settings.set('textareaEditorFontSize', fontSize);
    this.applyFontSize(fontSize);
  }

  private applySettings(next: Settings): void {
    syncEditorControlValuesFromSettings();
    if (!this.view) return;

    // Language is not a stored setting — it is detected, or overridden in the
    // header — so a settings change never touches it.
    this.setWrapMode(next.textareaEditorWrap);
    this.applyFontSize(next.textareaEditorFontSize);
  }

  private followSettings(): void {
    if (this.unsubscribeSettings) return;

    this.unsubscribeSettings = settings.subscribe((next) => {
      if (!this.overlay) return;
      this.applySettings(next);
    });
  }

  close(): void {
    if (!this.overlay || this.overlay.style.display === 'none') return;
    this.overlay.style.display = 'none';
    this.source = null;
    this.scope = null;
    this.variableSource = null;
    this.destroyView();
    modalLock.unlock();
  }

  /** Close, and remove the modal's DOM, listeners and settings subscription. */
  dispose(): void {
    this.close();
    document.removeEventListener('keydown', this.onKeydown, true);
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.overlay?.remove();
    this.overlay = null;
  }

  private async copyAll(): Promise<void> {
    const text = this.text();
    if (!text.trim()) {
      toast.show('Nothing to copy');
      return;
    }
    const copied = await copyText(text);
    toast.show(copied ? 'Copied editor text' : 'Failed to copy');
  }

  private save(): void {
    const sourceEl = this.source;
    const saveBtn = byId<HTMLButtonElement>(SAVE_BTN_ID);

    if (!sourceEl || !saveBtn || !this.view) {
      return;
    }

    // Read-only sources now reach this path: a published AD method opens here
    // for reading, and Ctrl+S is muscle memory. Say why nothing was written
    // rather than swallowing the keystroke. The editor itself stays editable on
    // purpose — scratch-editing a published step is useful — so this is the
    // only place the boundary is felt.
    if (saveBtn.disabled) {
      toast.show('Read-only field — nothing was written back');
      return;
    }

    syncSourceTextarea(sourceEl, this.text());
    toast.show('Textarea updated');
    this.close();
  }

  private showSource(sourceEl: HTMLTextAreaElement): void {
    const title = byId<HTMLElement>(TITLE_ID);
    const subtitle = byId<HTMLElement>(SUBTITLE_ID);
    const saveBtn = byId<HTMLButtonElement>(SAVE_BTN_ID);

    if (!title || !subtitle || !saveBtn) return;

    const readOnly = sourceEl.readOnly || sourceEl.disabled;

    title.textContent = 'Large Text Editor';
    subtitle.textContent = readOnly
      ? `${describeSource(sourceEl)} (read only)`
      : describeSource(sourceEl);

    saveBtn.disabled = readOnly;
    saveBtn.style.opacity = readOnly ? '0.45' : '1';
    saveBtn.style.cursor = readOnly ? 'not-allowed' : 'pointer';

    const status = byId<HTMLElement>(STATUS_ID);
    if (status) status.textContent = this.scope ? scopeStatus(this.scope) : DEFAULT_STATUS;

    syncEditorControlValuesFromSettings();
    this.createView(sourceEl);
  }

  // Escape, Ctrl+S and Ctrl+F while the editor is open. Capture phase, so
  // the host page's own shortcuts never see them.
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (!this.overlay || this.overlay.style.display !== 'flex') {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.save();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      const view = this.view;
      if (view) {
        openSearchPanel(view);
        // The view itself, not `this.view`: the editor may have been closed
        // (and this.view cleared) by the time the frame runs.
        requestAnimationFrame(() => {
          view.dom.querySelector<HTMLInputElement>('.cm-search input')?.focus();
        });
      }
    }
  };

  private ensureOverlay(): HTMLDivElement {
    // The host app can wipe and re-render the body, taking the modal with it.
    // Drop the detached one (listeners, view, the modal lock if it was open)
    // and build afresh.
    if (this.overlay && !this.overlay.isConnected) this.dispose();
    if (this.overlay) return this.overlay;

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
    appendOptions(fontSizeSelect, SETTINGS.textareaEditorFontSize);

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
    appendOptions(wrapSelect, SETTINGS.textareaEditorWrap);

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
      settingsModal.open();
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
      this.copyAll();
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
    closeBtn.onclick = () => this.close();

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
    helper.id = STATUS_ID;
    helper.textContent = DEFAULT_STATUS;
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
    cancelBtn.onclick = () => this.close();

    const saveBtn = document.createElement('button');
    saveBtn.id = SAVE_BTN_ID;
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    Object.assign(saveBtn.style, PRIMARY_BUTTON_STYLE, TEXT_BTN);
    applyHoverEffect(saveBtn, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER);
    saveBtn.onclick = () => this.save();

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
        this.close();
      }
    });

    document.body.appendChild(overlay);
    this.overlay = overlay;
    document.addEventListener('keydown', this.onKeydown, true);
    this.followSettings();
    languageSelect.addEventListener('change', () => this.onLanguagePicked());
    wrapSelect.addEventListener('change', () => this.onWrapPicked());
    fontSizeSelect.addEventListener('change', () => this.onFontSizePicked());
    syncEditorControlValuesFromSettings();

    return this.overlay;
  }

  /**
   * Edit `sourceEl`. `scope`, when given, turns on `#{variable}` completion,
   * hover and lint for this open (AD pages only; see scope.ts).
   */
  open(sourceEl: HTMLTextAreaElement, scope: VariableScope | null = null): void {
    if (!sourceEl) return;

    const modal = this.ensureOverlay();
    const wasOpen = modal.style.display === 'flex';
    this.source = sourceEl;
    this.scope = scope;
    this.variableSource = scope ? variableCompletionSource(scope) : null;
    this.showSource(sourceEl);
    modal.style.display = 'flex';
    if (!wasOpen) {
      modalLock.lock();
    }

    if (this.view) {
      this.view.focus();
    }
  }
}

/** The page's large text editor. */
export const textareaEditorModal = new TextareaEditorModal();
