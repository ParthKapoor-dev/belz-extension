// Keyboard shortcuts on designer pages: Run Test, Esc Esc, copy link, JSON editor.
import { triggerRunTest } from '../run-test/index';
import { modalLock } from '../../ui/modal-lock';
import { extractMethodName, extractServiceCategory } from '../../utils/dom';
import { toast } from '../../ui/toast';
import { Rearm } from '../../core/rearm';
import { AD_ROUTE_PREFIX } from '../../../config/routes';
import { TIMINGS } from '../../../config/timings';
import type { Feature } from '../../core/feature';

// Window within which a second Escape press counts as an "Esc Esc".
const DOUBLE_ESCAPE_WINDOW_MS = 500;

// Fields whose edits the AD app only commits once focus leaves them.
function isEditableElement(element: Element | null): element is HTMLElement {
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (element as HTMLElement).isContentEditable === true
  );
}

// Move focus off the active field so its pending value is registered. AD test
// inputs only commit an edit on blur, so an in-place edit is otherwise lost
// when a shortcut acts on the page.
function commitActiveElement(): boolean {
  const element = document.activeElement;
  if (!isEditableElement(element)) return false;

  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.blur();
  element.dispatchEvent(new Event('blur', { bubbles: true }));
  return true;
}

async function copyAdRichLink(): Promise<void> {
  const category = extractServiceCategory();
  const name = extractMethodName();
  const url = window.location.href;

  const label = [category, name].filter(Boolean).join('::');

  const html = `<a href="${url}">${label}</a>`;
  const plain = `[${label}](${url})`;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      })
    ]);
    toast.show(`Copied: ${label}`);
  } catch {
    // fallback: plain URL
    try {
      await navigator.clipboard.writeText(plain);
      toast.show('Copied link (plain)');
    } catch {
      toast.show('Failed to copy link');
    }
  }
}

export class KeyboardShortcuts implements Feature {
  private lastEscapeTime = 0;
  /**
   * Re-attach while the host app boots: a listener registered too early can
   * go dead, and the shortcuts then stayed dead until a settings toggle.
   */
  private readonly rearm = new Rearm(() => this.attach());

  /**
   * @param openJsonEditor What Shift+J opens. Only the AD content script
   *   passes one, so the JSON editor is not bundled into PD pages.
   */
  constructor(private readonly openJsonEditor: (() => void) | null = null) {}

  start(): void {
    this.attach();
    this.rearm.start();
  }

  stop(): void {
    this.rearm.stop();
    window.removeEventListener('keydown', this.onKeydown, true);
  }

  // Idempotently (re)attach the keydown listener. Bound to `window` so it
  // survives the AD app replacing parts of the document, and the leading
  // removeEventListener guarantees the listener is never stacked twice.
  private attach(): void {
    window.removeEventListener('keydown', this.onKeydown, true);
    window.addEventListener('keydown', this.onKeydown, true);
  }

  // An arrow property, so add/removeEventListener always see the same function.
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (modalLock.isLocked) return;

    // Run Test — Ctrl+Shift+Enter. Commit any focused field first so the test
    // runs against the edited value rather than a stale one.
    if (event.ctrlKey && event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (commitActiveElement()) {
        // Give the AD app a moment to register the blur before running.
        setTimeout(triggerRunTest, TIMINGS.runTestCommitSettle);
      } else {
        triggerRunTest();
      }
      return;
    }

    // Esc Esc — return focus to the page so a pending textbox edit registers.
    if (event.key === 'Escape') {
      const now = Date.now();
      const isDoubleEscape = now - this.lastEscapeTime <= DOUBLE_ESCAPE_WINDOW_MS;
      if (isDoubleEscape && isEditableElement(document.activeElement)) {
        this.lastEscapeTime = 0;
        event.preventDefault();
        event.stopPropagation();
        commitActiveElement();
        toast.show('Focus returned to page');
      } else {
        this.lastEscapeTime = now;
      }
      return;
    }

    // Copy AD rich link — Shift+L (ignored while typing in a field).
    if (event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === 'L') {
      if (!window.location.pathname.startsWith(AD_ROUTE_PREFIX)) return;
      if (isEditableElement(document.activeElement)) return;

      event.preventDefault();
      event.stopPropagation();
      copyAdRichLink();
      return;
    }

    // Open the JSON input editor — Shift+J (ignored while typing in a field).
    if (this.openJsonEditor && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === 'J') {
      if (!window.location.pathname.startsWith(AD_ROUTE_PREFIX)) return;
      if (isEditableElement(document.activeElement)) return;

      event.preventDefault();
      event.stopPropagation();
      this.openJsonEditor();
    }
  };
}
