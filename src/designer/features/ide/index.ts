// IDE launcher — a single floating overlay shared by every
// textarea on the page.
//
// Per-textarea controls are deliberately avoided: wrapping each textarea in a
// positioned <div> with its own buttons costs four extra elements per textarea
// (~480 on a 40-step Automation Designer method), a layout-sync pass over all
// of them, and a full-page rescan on every DOM mutation to keep them attached,
// and makes the extension a heavy source of the very mutations it reacts to.
//
// The shared-overlay machinery lives in designer/ui/hover-overlay.ts, so this
// file is just what makes a textarea overlay a textarea overlay: which
// elements qualify, which buttons appear, and how they shrink for a short box.

import { toast } from '../../ui/toast';
import { copyText } from '../../utils/clipboard';
import { textareaUnderPointer } from '../../utils/dom';
import { ns } from '../../../config/namespace';
import { HoverOverlay, type OverlaySize } from '../../ui/hover-overlay';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER,
  PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER
} from '../../ui/styles';
import { createLogger } from '../../../shared/logger';
import type { Feature } from '../../core/feature';
import { settings } from '../../core/settings';
import type { ScopeProvider, VariableScope } from './scope';

const log = createLogger('ide');

const CONTROLS_ID = ns('TextareaControls');
const TEXTAREA_COPY_BUTTON_CLASS = ns('TextareaCopyButton');

type ModalModule = typeof import('./modal');

// Read-only and disabled textareas qualify too.
//
// A PUBLISHED Automation Designer method renders its steps as non-editable
// fields, and Open + Copy are exactly what you want there: reading a long SQL
// step in the IDE, and copying it out. Refusing them meant the
// overlay only ever appeared on drafts.
//
// Nothing can be written back by accident — the modal already handles a
// read-only source: IdeModal.showSource() marks the subtitle
// "(read only)" and disables Save, and save() bails on a disabled button.
//
// The hit test is for `disabled` specifically: document-level delegation
// never sees a disabled textarea itself (see textareaUnderPointer).
function resolveTextarea(node: Element, event: Event): HTMLTextAreaElement | null {
  if (node.tagName === 'TEXTAREA') return node as HTMLTextAreaElement;
  return textareaUnderPointer(event);
}

// A short textarea cannot carry two full-size buttons stacked without covering
// its content, so they shrink to fit the box.
function sizeForTextarea(rect: DOMRect): OverlaySize {
  const compact = rect.height > 0 && rect.height < 36;
  const buttonSize = compact ? Math.max(16, Math.min(22, rect.height - 4)) : 28;
  return {
    compact,
    buttonSize,
    glyphSize: Math.max(10, Math.round(buttonSize * 0.5))
  };
}

export class Ide implements Feature {
  /**
   * `scopeProvider` reads the `#{variables}` in scope at a textarea, for the
   * IDE's completion, hover and lint. Only ad-content.ts passes one
   * (designer/features/ad-scope), so PD pages do not bundle the scanner and
   * their IDE simply has no variables.
   */
  constructor(private readonly scopeProvider?: ScopeProvider) {}

  private readonly overlay = new HoverOverlay({
    id: CONTROLS_ID,
    label: 'textarea overlay',
    resolveTarget: resolveTextarea,
    sizeFor: sizeForTextarea,
    buttons: [
      {
        className: ns('TextareaLauncher'),
        glyph: '⤢',
        title: 'Open in IDE',
        style: PRIMARY_BUTTON_STYLE,
        hover: [PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER],
        adjust: (el: HTMLButtonElement, size: OverlaySize) => {
          el.style.fontSize = `${Math.max(size.glyphSize, 11)}px`;
        },
        onClick: (textarea: HTMLTextAreaElement) => this.openIdeFor(textarea)
      },
      {
        className: TEXTAREA_COPY_BUTTON_CLASS,
        glyph: '⧉',
        title: 'Copy the text box',
        style: ICON_BUTTON_STYLE,
        hover: [ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER],
        adjust: (el: HTMLButtonElement, size: OverlaySize) => {
          el.style.fontSize = `${Math.max(size.glyphSize - 1, 10)}px`;
        },
        onClick: async (textarea: HTMLTextAreaElement) => {
          const textToCopy = textarea.value || '';
          if (!textToCopy.trim()) {
            toast.show('Nothing to copy');
            return;
          }
          const copied = await copyText(textToCopy);
          toast.show(copied ? 'Text box copied' : 'Failed to copy the text box');
        }
      }
    ]
  });

  // The IDE modal is loaded on first use, not with the page.
  //
  // modal.ts pulls in CodeMirror and every language mode: ~600 KB, which was
  // ~94% of each content script and was parsed on every AD and PD page load
  // whether or not anyone opened the IDE. The bundler splits this dynamic
  // import into its own chunk, fetched the first time Open is clicked.
  //
  // The chunk shares core/settings, ui/modal-lock and the other singletons
  // with the rest of the content script through common chunks, so there is
  // still exactly ONE instance of each — see scripts/build.mjs for why that
  // is not automatic.
  private modal: Promise<ModalModule> | null = null;

  start(): void {
    this.overlay.start();
  }

  stop(): void {
    this.overlay.stop();
    // Only an IDE that was ever loaded can be open. Never trigger the load
    // just to close something that cannot exist.
    this.modal?.then((m) => m.ideModal.dispose(), () => {});
  }

  private loadModal(): Promise<ModalModule> {
    this.modal ??= import('./modal').catch((error) => {
      // Forget the failure, so the next click retries instead of replaying a
      // cached rejection forever.
      this.modal = null;
      throw error;
    });
    return this.modal;
  }

  /** The variables in scope at `textarea`, read once per open; null when off or unavailable. */
  private scopeFor(textarea: HTMLTextAreaElement): VariableScope | null {
    if (!this.scopeProvider || !settings.get().ideIntellisense) return null;
    try {
      return this.scopeProvider(textarea);
    } catch (error) {
      // A page the scanner cannot read still gets its IDE, just without variables.
      log.warn('could not read the variables in scope:', error);
      return null;
    }
  }

  private async openIdeFor(textarea: HTMLTextAreaElement): Promise<void> {
    // With IDE Vim Mode on, fetch the Vim chunk alongside the IDE's rather
    // than after it: the modal's own import('./vim') then finds it loaded.
    // Off, it is never requested. A failed load is the modal's to report.
    if (settings.get().ideVim) import('./vim').catch(() => {});
    try {
      const { ideModal } = await this.loadModal();
      ideModal.open(textarea, this.scopeFor(textarea));
    } catch (error) {
      log.error('IDE failed to load:', error);
      toast.show('IDE failed to load — see console');
    }
  }
}
