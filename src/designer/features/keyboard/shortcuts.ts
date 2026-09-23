// Keyboard shortcuts on designer pages: Esc Esc everywhere, and the actions a
// page passes in (Run Test, copy link, JSON editor: Automation Designer only).
import { modalLock } from '../../ui/modal-lock';
import { toast } from '../../ui/toast';
import { Rearm } from '../../core/rearm';
import { pageObserver } from '../../core/observer';
import { TIMINGS } from '../../../config/timings';
import type { Feature } from '../../core/feature';

// Window within which a second Escape press counts as an "Esc Esc".
const DOUBLE_ESCAPE_WINDOW_MS = 500;

/**
 * What a page wires up. Each action is passed in by the content script of the
 * page that has it, so a page without Run Test (Page Designer) neither
 * bundles nor swallows its chord.
 */
export interface ShortcutActions {
  /** Ctrl+Shift+Enter: `available()` finds the page's Run Test button; `run()` clicks it. */
  runTest?: { available(): boolean; run(): void };
  /** Shift+L: copy a link to the open method. */
  copyLink?: () => void;
  /** Shift+J: open the JSON input editor; false when it is switched off. */
  openJsonEditor?: () => boolean;
}

// Fields whose edits the AD app only commits once focus leaves them.
function isEditableElement(element: Element | null | undefined): element is HTMLElement {
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (element as HTMLElement).isContentEditable === true
  );
}

/** The focused element, looking inside open shadow roots. */
function deepActiveElement(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}

/**
 * True while the user is typing: the key comes from an editable element
 * (inside a shadow root too), or focus is in a field or in an iframe, whose
 * own fields this document cannot see.
 */
function isTyping(event: KeyboardEvent): boolean {
  const origin = event.composedPath?.()[0];
  if (origin instanceof Element && isEditableElement(origin)) return true;
  const active = deepActiveElement();
  return isEditableElement(active) || active?.tagName === 'IFRAME';
}

// Move focus off the active field so its pending value is registered. AD test
// inputs only commit an edit on blur, so an in-place edit is otherwise lost
// when a shortcut acts on the page.
function commitActiveElement(): boolean {
  const element = deepActiveElement();
  if (!isEditableElement(element)) return false;

  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.blur();
  element.dispatchEvent(new Event('blur', { bubbles: true }));
  return true;
}

/** A plain Shift+letter chord: no Ctrl, Alt or Meta. */
const isShiftLetter = (event: KeyboardEvent, letter: string): boolean =>
  event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key === letter;

export class KeyboardShortcuts implements Feature {
  private lastEscapeTime = 0;
  /**
   * Re-attach while the host app boots: a listener registered too early can
   * go dead, and the shortcuts then stayed dead until a settings toggle.
   */
  private readonly rearm = new Rearm(() => this.attach());
  private unsubscribe: (() => void) | null = null;
  private runTimer: ReturnType<typeof setTimeout> | null = null;

  /** @param actions What this page wires up; see ShortcutActions. */
  constructor(private readonly actions: ShortcutActions = {}) {}

  start(): void {
    this.attach();
    this.rearm.start();
    // Also re-assert the listener on every page change (and the observer's
    // poll). Without this self-healing, a listener the page dropped after
    // boot left the shortcuts silently dead until a settings toggle
    // re-attached them.
    this.unsubscribe ??= pageObserver.subscribe(this.attach);
  }

  stop(): void {
    this.rearm.stop();
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.runTimer) clearTimeout(this.runTimer);
    this.runTimer = null;
    window.removeEventListener('keydown', this.onKeydown, true);
  }

  // Idempotently (re)attach the keydown listener. Bound to `window` so it
  // survives the AD app replacing parts of the document, and the leading
  // removeEventListener guarantees the listener is never stacked twice.
  private readonly attach = (): void => {
    window.removeEventListener('keydown', this.onKeydown, true);
    window.addEventListener('keydown', this.onKeydown, true);
  };

  /** Stop the page (and the browser) acting on a key we handled. */
  private claim(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  // An arrow property, so add/removeEventListener always see the same function.
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (modalLock.isLocked) return;
    const { runTest, copyLink, openJsonEditor } = this.actions;

    // Run Test — Ctrl+Shift+Enter, even while typing. Only claimed when the
    // page has a Run Test button to click. Commit any focused field first so
    // the test runs against the edited value rather than a stale one.
    if (runTest && event.ctrlKey && event.shiftKey && event.key === 'Enter') {
      if (!runTest.available()) return;
      this.claim(event);
      if (commitActiveElement()) {
        // Give the AD app a moment to register the blur before running.
        if (this.runTimer) clearTimeout(this.runTimer);
        this.runTimer = setTimeout(() => {
          this.runTimer = null;
          runTest.run();
        }, TIMINGS.runTestCommitSettle);
      } else {
        runTest.run();
      }
      return;
    }

    // Esc Esc — return focus to the page so a pending textbox edit registers.
    if (event.key === 'Escape') {
      const now = Date.now();
      const isDoubleEscape = now - this.lastEscapeTime <= DOUBLE_ESCAPE_WINDOW_MS;
      if (isDoubleEscape && isEditableElement(deepActiveElement())) {
        this.lastEscapeTime = 0;
        this.claim(event);
        commitActiveElement();
        toast.show('Focus returned to page');
      } else {
        this.lastEscapeTime = now;
      }
      return;
    }

    // Plain letters are text while the user types: never act on them then.
    if (copyLink && isShiftLetter(event, 'L')) {
      if (isTyping(event)) return;
      this.claim(event);
      copyLink();
      return;
    }

    if (openJsonEditor && isShiftLetter(event, 'J')) {
      if (isTyping(event)) return;
      // Switched off: leave the key to the page.
      if (openJsonEditor()) this.claim(event);
    }
  };
}
