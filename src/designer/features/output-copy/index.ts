// Output copy — one floating Copy button shared by every output container.
//
// A button injected into each output container would cost, on a 40-step
// method, 80 injected nodes, 40 forced style resolutions, 40 mutations of the
// page's own markup, and a querySelectorAll sweep per mutation batch. So it is
// a single hover-positioned overlay that touches nothing on the page. See
// designer/ui/hover-overlay.ts.

import { AD } from '../../../config/selectors';
import { EXTENSION_OWNED_ATTR, ns } from '../../../config/namespace';
import { toast } from '../../ui/toast';
import { copyText } from '../../utils/clipboard';
import { textareaUnderPointer } from '../../utils/dom';
import { HoverOverlay } from '../../ui/hover-overlay';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER
} from '../../ui/styles';
import type { Feature } from '../../core/feature';

const CONTROLS_ID = ns('OutputCopyControls');

function extractOutputText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  // Defensive: the overlay itself lives outside the container now, but the
  // JSON editor and other features may still have injected something inside.
  for (const node of clone.querySelectorAll(`[${EXTENSION_OWNED_ATTR}]`)) {
    node.remove();
  }
  return (clone.innerText || clone.textContent || '').trim();
}

function resolveOutputContainer(node: Element, event: Event): HTMLElement | null {
  if (typeof node.closest !== 'function') return null;
  // A textarea inside an output container belongs to the textarea overlay,
  // which is the more specific target — otherwise both would appear stacked in
  // the same corner.
  if (node.tagName === 'TEXTAREA') return null;
  // Same rule, for a disabled textarea the tag check cannot see.
  if (textareaUnderPointer(event)) return null;
  return node.closest<HTMLElement>(AD.outputContainer);
}

export class OutputCopy implements Feature {
  private readonly overlay = new HoverOverlay({
    id: CONTROLS_ID,
    label: 'output copy overlay',
    inset: 8,
    resolveTarget: resolveOutputContainer,
    buttons: [
      {
        glyph: '⧉',
        title: 'Copy output JSON',
        style: ICON_BUTTON_STYLE,
        hover: [ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER],
        onClick: async (container: HTMLElement) => {
          const textToCopy = extractOutputText(container);
          if (!textToCopy) {
            toast.show('Nothing to copy');
            return;
          }
          const copied = await copyText(textToCopy);
          toast.show(copied ? 'Output copied' : 'Failed to copy output');
        }
      }
    ]
  });

  start(): void {
    this.overlay.start();
  }

  stop(): void {
    this.overlay.stop();
  }
}
