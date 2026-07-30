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
// See src/ui/hover-overlay.js.

import {
  OUTPUT_CONTAINER_SELECTOR,
  EXTENSION_OWNED_ATTR
} from '../../config/constants.js';
import { showToast } from '../../ui/toast.js';
import { copyText } from '../../utils/clipboard.js';
import { log } from '../../core/logger.js';
import { createHoverOverlay } from '../../ui/hover-overlay.js';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER
} from '../../ui/styles.js';

const CONTROLS_ID = 'sdExtensionOutputCopyControls';

function extractOutputText(container) {
  const clone = container.cloneNode(true);
  // Defensive: the overlay itself lives outside the container now, but the
  // JSON editor and other features may still have injected something inside.
  for (const node of clone.querySelectorAll(`[${EXTENSION_OWNED_ATTR}]`)) {
    node.remove();
  }
  return (clone.innerText || clone.textContent || '').trim();
}

function resolveOutputContainer(node) {
  if (typeof node.closest !== 'function') return null;
  // A textarea inside an output container belongs to the textarea overlay,
  // which is the more specific target — otherwise both would appear stacked in
  // the same corner.
  if (node.tagName === 'TEXTAREA') return null;
  return node.closest(OUTPUT_CONTAINER_SELECTOR);
}

const overlay = createHoverOverlay({
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
      onClick: async (container) => {
        const textToCopy = extractOutputText(container);
        if (!textToCopy) {
          showToast('Nothing to copy');
          return;
        }
        const copied = await copyText(textToCopy);
        showToast(copied ? 'Output copied' : 'Failed to copy output');
      }
    }
  ]
});

export function startOutputCopyFeature() {
  log('Initializing output copy feature...');
  overlay.start();
  return stopOutputCopyFeature;
}

export function stopOutputCopyFeature() {
  overlay.stop();
}
