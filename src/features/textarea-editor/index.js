// Textarea editor launcher — a single floating overlay shared by every
// textarea on the page.
//
// The earlier design wrapped each textarea in a positioned <div> and appended
// its own controls node with two buttons: four extra elements per textarea,
// which on a 40-step Automation Designer method meant ~480 injected elements,
// a layout-sync pass over all of them, and a full-page rescan on every DOM
// mutation to keep them attached. It also made the extension a heavy source of
// the very mutations it was reacting to.
//
// The shared-overlay machinery now lives in src/ui/hover-overlay.js, so this
// file is just what makes a textarea overlay a textarea overlay: which
// elements qualify, which buttons appear, and how they shrink for a short box.

import { log } from '../../core/logger.js';
import { showToast } from '../../ui/toast.js';
import { copyText } from '../../utils/clipboard.js';
import { TEXTAREA_EDITOR_LAUNCHER_CLASS } from '../../config/constants.js';
import { closeTextareaEditor, openTextareaEditor } from './modal.js';
import { createHoverOverlay } from '../../ui/hover-overlay.js';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER,
  PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER
} from '../../ui/styles.js';

const CONTROLS_ID = 'sdExtensionTextareaControls';
const TEXTAREA_COPY_BUTTON_CLASS = 'sdExtensionTextareaCopyButton';

function resolveTextarea(node) {
  if (node.tagName !== 'TEXTAREA') return null;
  if (node.disabled || node.readOnly) return null;
  return node;
}

// A short textarea cannot carry two full-size buttons stacked without covering
// its content, so they shrink to fit the box.
function sizeForTextarea(rect) {
  const compact = rect.height > 0 && rect.height < 36;
  const buttonSize = compact ? Math.max(16, Math.min(22, rect.height - 4)) : 28;
  return {
    compact,
    buttonSize,
    glyphSize: Math.max(10, Math.round(buttonSize * 0.5))
  };
}

const overlay = createHoverOverlay({
  id: CONTROLS_ID,
  label: 'textarea overlay',
  resolveTarget: resolveTextarea,
  sizeFor: sizeForTextarea,
  buttons: [
    {
      className: TEXTAREA_EDITOR_LAUNCHER_CLASS,
      glyph: '⤢',
      title: 'Open large editor',
      style: PRIMARY_BUTTON_STYLE,
      hover: [PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER],
      adjust: (el, size) => {
        el.style.fontSize = `${Math.max(size.glyphSize, 11)}px`;
      },
      onClick: (textarea) => openTextareaEditor(textarea)
    },
    {
      className: TEXTAREA_COPY_BUTTON_CLASS,
      glyph: '⧉',
      title: 'Copy textarea content',
      style: ICON_BUTTON_STYLE,
      hover: [ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER],
      adjust: (el, size) => {
        el.style.fontSize = `${Math.max(size.glyphSize - 1, 10)}px`;
        el.style.borderRadius = size.compact ? '6px' : '8px';
      },
      onClick: async (textarea) => {
        const textToCopy = textarea.value || '';
        if (!textToCopy.trim()) {
          showToast('Nothing to copy');
          return;
        }
        const copied = await copyText(textToCopy);
        showToast(copied ? 'Textarea copied' : 'Failed to copy textarea');
      }
    }
  ]
});

export function startTextareaEditorFeature() {
  log('Initializing textarea editor feature...');
  overlay.start();
  return stopTextareaEditorFeature;
}

export function stopTextareaEditorFeature() {
  overlay.stop();
  closeTextareaEditor();
}
