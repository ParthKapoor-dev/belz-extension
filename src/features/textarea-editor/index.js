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
// Instead there is ONE controls element, positioned over whichever textarea
// the pointer or keyboard focus is currently on. That means:
//
//   - injected DOM is O(1) in page size, not O(textareas)
//   - the page's own markup is never restructured (no wrappers)
//   - no scanning: hover/focus delegation picks up textareas added later for
//     free, so this feature no longer subscribes to the MutationObserver
//   - only one element is ever measured or positioned

import { log } from '../../core/logger.js';
import { showToast } from '../../ui/toast.js';
import { copyText } from '../../utils/clipboard.js';
import {
  TEXTAREA_EDITOR_LAUNCHER_CLASS,
  EXTENSION_OWNED_ATTR
} from '../../config/constants.js';
import { closeTextareaEditor, openTextareaEditor } from './modal.js';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER,
  PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER,
  applyHoverEffect
} from '../../ui/styles.js';

const CONTROLS_ID = 'sdExtensionTextareaControls';
const TEXTAREA_COPY_BUTTON_CLASS = 'sdExtensionTextareaCopyButton';

/** Keep the overlay up briefly so the pointer can travel onto the buttons. */
const HIDE_GRACE_MS = 120;
/** Gap between the textarea's top-right corner and the buttons. */
const INSET = 6;

let controlsEl = null;
let openButton = null;
let copyButton = null;

let activeTextarea = null;
let hideTimer = null;
let repositionScheduled = false;
let repositionTimer = null;
let listenersAttached = false;
/** The document the delegation is currently registered on. */
let attachedDocument = null;
/** Re-arm points, in ms after start — spanning a slow SPA bootstrap. */
const REARM_DELAYS_MS = [1000, 3000, 6000];
const rearmTimers = [];
let started = false;

// ---- eligibility ----------------------------------------------------------

function isEligibleTextarea(node) {
  if (!node || node.tagName !== 'TEXTAREA') return false;
  if (node.disabled || node.readOnly) return false;
  // Never decorate textareas inside our own UI (the large editor modal, the
  // settings modal, the JSON editor).
  if (node.closest && node.closest(`[${EXTENSION_OWNED_ATTR}]`)) return false;
  return true;
}

/**
 * The real event target, even inside an open shadow root. `event.target` is
 * retargeted to the shadow host as the event crosses the boundary; the first
 * entry of the composed path is the actual element under the pointer.
 */
function realTarget(event) {
  if (typeof event.composedPath === 'function') {
    const path = event.composedPath();
    if (path && path.length) return path[0];
  }
  return event.target;
}

// ---- the shared overlay ---------------------------------------------------

function buildControls() {
  const controls = document.createElement('div');
  controls.id = CONTROLS_ID;
  controls.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  Object.assign(controls.style, {
    position: 'fixed',
    display: 'none',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '6px',
    // Above the app's own chrome, below our modals.
    zIndex: '2147483000'
  });

  openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = TEXTAREA_EDITOR_LAUNCHER_CLASS;
  openButton.textContent = '⤢';
  openButton.setAttribute('title', 'Open large editor');
  openButton.setAttribute('aria-label', 'Open large editor');
  openButton.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  Object.assign(openButton.style, PRIMARY_BUTTON_STYLE, {
    width: '28px',
    height: '28px',
    fontSize: '14px'
  });
  applyHoverEffect(openButton, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER);

  copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = TEXTAREA_COPY_BUTTON_CLASS;
  copyButton.textContent = '⧉';
  copyButton.setAttribute('title', 'Copy textarea content');
  copyButton.setAttribute('aria-label', 'Copy textarea content');
  copyButton.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  Object.assign(copyButton.style, ICON_BUTTON_STYLE);
  applyHoverEffect(copyButton, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER);

  // Clicking a button must not pull focus out of the textarea — otherwise the
  // caret position the large editor restores is lost.
  for (const button of [openButton, copyButton]) {
    button.addEventListener('mousedown', (event) => event.preventDefault());
  }

  openButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (activeTextarea) openTextareaEditor(activeTextarea);
  });

  copyButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeTextarea) return;

    const textToCopy = activeTextarea.value || '';
    if (!textToCopy.trim()) {
      showToast('Nothing to copy');
      return;
    }
    const copied = await copyText(textToCopy);
    showToast(copied ? 'Textarea copied' : 'Failed to copy textarea');
  });

  controls.appendChild(openButton);
  controls.appendChild(copyButton);
  return controls;
}

function ensureControls() {
  if (controlsEl && controlsEl.isConnected) return controlsEl;
  // The host app wipes and re-renders the body on route changes, which takes
  // our overlay with it — rebuild rather than assume it survived.
  const host = document.body || document.documentElement;
  if (!host) return null;
  controlsEl = buildControls();
  host.appendChild(controlsEl);
  return controlsEl;
}

// ---- positioning ----------------------------------------------------------

function sizeForHeight(height) {
  const compact = height > 0 && height < 36;
  const buttonSize = compact ? Math.max(16, Math.min(22, height - 4)) : 28;
  return { compact, buttonSize, glyphSize: Math.max(10, Math.round(buttonSize * 0.5)) };
}

function position() {
  if (!activeTextarea || !controlsEl) return;

  if (!activeTextarea.isConnected) {
    hide();
    return;
  }

  // One read of the textarea's box drives both sizing and placement.
  const rect = activeTextarea.getBoundingClientRect();

  // Scrolled out of view (or collapsed) — nothing to hover.
  const offscreen =
    rect.bottom <= 0 ||
    rect.top >= window.innerHeight ||
    rect.right <= 0 ||
    rect.left >= window.innerWidth ||
    rect.width === 0 ||
    rect.height === 0;
  if (offscreen) {
    controlsEl.style.display = 'none';
    return;
  }

  const { compact, buttonSize, glyphSize } = sizeForHeight(rect.height);

  Object.assign(openButton.style, {
    width: `${buttonSize}px`,
    height: `${buttonSize}px`,
    fontSize: `${Math.max(glyphSize, 11)}px`
  });
  Object.assign(copyButton.style, {
    width: `${buttonSize}px`,
    height: `${buttonSize}px`,
    fontSize: `${Math.max(glyphSize - 1, 10)}px`,
    borderRadius: compact ? '6px' : '8px'
  });

  Object.assign(controlsEl.style, {
    display: 'flex',
    top: `${Math.max(rect.top + INSET, INSET)}px`,
    left: `${rect.right - INSET - buttonSize}px`
  });
}

function runReposition() {
  if (!repositionScheduled) return; // the other scheduler already handled it
  repositionScheduled = false;
  if (repositionTimer) {
    clearTimeout(repositionTimer);
    repositionTimer = null;
  }
  position();
}

// Coalesce a burst of scroll/resize/input events into one reposition.
//
// requestAnimationFrame is the right primitive — it runs just before paint,
// after layout has settled — but it is suspended entirely in some contexts
// (backgrounded tabs, headless rendering). A short timeout backstop means a
// missing frame can never leave the overlay floating over the wrong element.
// Whichever fires first wins; the flag stops the other from repeating it.
function scheduleReposition() {
  if (repositionScheduled || !activeTextarea) return;
  repositionScheduled = true;
  requestAnimationFrame(runReposition);
  repositionTimer = setTimeout(runReposition, 32);
}

function show(textarea) {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  activeTextarea = textarea;
  if (!ensureControls()) return;
  position();
}

function hide() {
  activeTextarea = null;
  if (controlsEl) controlsEl.style.display = 'none';
}

function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    hide();
  }, HIDE_GRACE_MS);
}

// ---- delegated events -----------------------------------------------------
// All of these are document-level and capture-phase, so a textarea that
// appears later needs no registration of any kind.

let sawAnyHover = false;
let sawTextareaHover = false;
function onPointerOver(event) {
  const target = realTarget(event);
  if (!sawAnyHover) {
    sawAnyHover = true;
    console.log(
      '[belz] textarea overlay: delegation live — first target <' +
        (target && target.tagName ? target.tagName.toLowerCase() : '?') + '>'
    );
  }
  if (!sawTextareaHover && target && target.tagName === 'TEXTAREA') {
    sawTextareaHover = true;
    console.log(
      '[belz] textarea overlay: first textarea hover — eligible=' +
        isEligibleTextarea(target)
    );
  }
  if (controlsEl && controlsEl.contains(target)) {
    // Moving onto the buttons themselves keeps the current textarea active.
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    return;
  }
  if (isEligibleTextarea(target)) {
    show(target);
    return;
  }
  if (activeTextarea) scheduleHide();
}

function onFocusIn(event) {
  const target = realTarget(event);
  if (isEligibleTextarea(target)) show(target);
}

function onFocusOut(event) {
  const target = realTarget(event);
  if (target === activeTextarea) scheduleHide();
}

function onScroll() {
  // Capture phase, so this also fires for scrollable containers, not just the
  // window. Cheap because only one element is ever repositioned.
  scheduleReposition();
}

function onResize() {
  scheduleReposition();
}

function onInput(event) {
  // Auto-growing textareas change height as the user types.
  if (realTarget(event) === activeTextarea) scheduleReposition();
}

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  attachedDocument = document;
  console.log('[belz] textarea overlay: listeners attached');
  document.addEventListener('mouseover', onPointerOver, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
}

// Re-register the delegation from scratch. The host SPA bootstraps after our
// content script runs (document_idle), and listeners registered before that
// point were observed never to receive events, while identical ones registered
// afterwards work — which is exactly what toggling the feature off and on was
// doing by hand. Re-arming a few times over the first seconds, and on the
// document lifecycle events, covers it without depending on why.
function rearmListeners() {
  if (!started) return;
  const sameDocument = attachedDocument === document;
  if (!sameDocument) {
    console.log('[belz] textarea overlay: document was replaced — re-arming');
  }
  detachListeners();
  attachListeners();
}

function scheduleRearms() {
  for (const delay of REARM_DELAYS_MS) {
    rearmTimers.push(setTimeout(rearmListeners, delay));
  }
  window.addEventListener('load', rearmListeners);
  window.addEventListener('pageshow', rearmListeners);
}

function cancelRearms() {
  for (const timer of rearmTimers) clearTimeout(timer);
  rearmTimers.length = 0;
  window.removeEventListener('load', rearmListeners);
  window.removeEventListener('pageshow', rearmListeners);
}

function detachListeners() {
  if (!listenersAttached) return;
  listenersAttached = false;
  console.log('[belz] textarea overlay: listeners DETACHED');
  document.removeEventListener('mouseover', onPointerOver, true);
  document.removeEventListener('focusin', onFocusIn, true);
  document.removeEventListener('focusout', onFocusOut, true);
  document.removeEventListener('input', onInput, true);
  document.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onResize);
}

// ---- lifecycle ------------------------------------------------------------

export function startTextareaEditorFeature() {
  log('Initializing textarea editor feature...');

  // Listeners FIRST, and never behind a guard that can be left half-set.
  //
  // These are the whole feature: the overlay itself is created lazily on the
  // first hover. Building it here instead meant that if the host app had not
  // settled its <body> yet — this runs at document_idle, while an SPA is still
  // bootstrapping — the append could throw and take attachListeners() with it,
  // leaving the feature permanently dead until something called stop()/start()
  // again. Toggling the setting off and on was the only way back.
  //
  // attachListeners() is idempotent, so re-entry is harmless and no `started`
  // flag is needed to protect it.
  started = true;
  attachListeners();
  scheduleRearms();

  return stopTextareaEditorFeature;
}

export function stopTextareaEditorFeature() {
  started = false;
  cancelRearms();
  detachListeners();

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (repositionTimer) {
    clearTimeout(repositionTimer);
    repositionTimer = null;
  }
  repositionScheduled = false;

  closeTextareaEditor();

  activeTextarea = null;
  if (controlsEl) {
    controlsEl.remove();
    controlsEl = null;
    openButton = null;
    copyButton = null;
  }
}
