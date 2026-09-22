// Output copy — one floating Copy button shared by every output container.
//
// The earlier design appended a controls <div> and a button into each output
// container, added a class and an inline `position: relative` to the container
// itself, marked it with an attribute, and rescanned the whole document on
// every DOM mutation to catch new ones. On a 40-step method that is 80 injected
// nodes, 40 forced style resolutions, 40 mutations of the page's own markup,
// and a querySelectorAll sweep per mutation batch.
//
// It is now a single hover-positioned overlay that touches nothing on the page.
// See designer/ui/hover-overlay.ts.

import { AD } from '../../../config/selectors';
import { EXTENSION_OWNED_ATTR } from '../../../config/namespace';
import { toast } from '../../ui/toast';
import { copyText } from '../../utils/clipboard';
import { HoverOverlay } from '../../ui/hover-overlay';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER
} from '../../ui/styles';
import type { Feature } from '../../core/feature';

const CONTROLS_ID = 'sdExtensionOutputCopyControls';

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
  // Same rule, for a textarea the tag check cannot see. A `disabled` control
  // dispatches no pointer events, so the hover is retargeted to this container
  // and `node` is never the textarea — hit-test the pointer to catch it.
  const { clientX, clientY } = event as MouseEvent;
  if (typeof clientX === 'number') {
    const under = document.elementFromPoint(clientX, clientY);
    if (under && under.tagName === 'TEXTAREA') return null;
  }
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
