/*! belz-singleton: features/textarea-editor/index */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
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
import { createHoverOverlay } from '../../ui/hover-overlay.js';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER,
  PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER
} from '../../ui/styles.js';

const CONTROLS_ID = 'sdExtensionTextareaControls';

// The editor modal is loaded on first use, not with the page.
//
// modal.js pulls in CodeMirror and every language mode: ~600 KB, which was
// ~94% of each content script and was parsed on every AD and PD page load
// whether or not anyone opened the editor. The bundler splits this dynamic
// import into its own chunk, fetched the first time Open is clicked.
//
// The chunk shares core/state, core/settings and ui/modal-lock with the rest
// of the content script through common chunks, so there is still exactly ONE
// instance of each — see scripts/build.mjs for why that is not automatic.
let modalModule = null;

function loadModal() {
  if (!modalModule) {
    modalModule = import('./modal.js').catch((error) => {
      // Forget the failure, so the next click retries instead of replaying a
      // cached rejection forever.
      modalModule = null;
      throw error;
    });
  }
  return modalModule;
}

async function openEditorFor(textarea) {
  try {
    const modal = await loadModal();
    modal.openTextareaEditor(textarea);
  } catch (error) {
    console.error('[belz] textarea editor failed to load:', error);
    showToast('Editor failed to load — see console');
  }
}

const TEXTAREA_COPY_BUTTON_CLASS = 'sdExtensionTextareaCopyButton';

// Read-only and disabled textareas qualify too.
//
// A PUBLISHED Automation Designer method renders its steps as non-editable
// fields, and Open + Copy are exactly what you want there: reading a long SQL
// step in the large editor, and copying it out. Refusing them meant the
// overlay only ever appeared on drafts.
//
// Nothing can be written back by accident — the modal already handles a
// read-only source: updateModalForSource() marks the subtitle "(read only)"
// and disables Save, and handleSave() bails on a disabled button.
//
// The second branch is for `disabled` specifically. The browser dispatches no
// pointer events to a disabled control — the hover is retargeted to its
// nearest enabled ancestor — so document-level delegation never sees the
// textarea itself, and dropping the guard alone would not be enough. Hit
// testing is not suppressed the same way, so elementFromPoint still finds it.
// Guarded on clientX because focusin carries no coordinates; without that it
// would hit-test the viewport's top-left corner on every focus.
function resolveTextarea(node, event) {
  if (node.tagName === 'TEXTAREA') return node;

  if (!event || typeof event.clientX !== 'number') return null;
  const under = document.elementFromPoint(event.clientX, event.clientY);
  return under && under.tagName === 'TEXTAREA' ? under : null;
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
      onClick: (textarea) => openEditorFor(textarea)
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
  // Only an editor that was ever loaded can be open. Never trigger the load
  // just to close something that cannot exist.
  if (modalModule) {
    modalModule.then((modal) => modal.closeTextareaEditor(), () => {});
  }
}
