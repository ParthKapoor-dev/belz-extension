import { state } from '../../core/state.js';
import { log } from '../../core/logger.js';
import { showToast } from '../../ui/toast.js';
import { copyText } from '../../utils/clipboard.js';
import {
  TEXTAREA_SELECTOR,
  TEXTAREA_EDITOR_BOUND_ATTR,
  TEXTAREA_EDITOR_LAUNCHER_CLASS,
  EXTENSION_OWNED_ATTR
} from '../../config/constants.js';
import { closeTextareaEditor, openTextareaEditor } from './modal.js';
import { subscribeObserver } from '../../core/observer.js';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER,
  PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER,
  applyHoverEffect
} from '../../ui/styles.js';

const TEXTAREA_EDITOR_ID_ATTR = 'data-sd-textarea-editor-id';
const TEXTAREA_EDITOR_FOR_ATTR = 'data-sd-textarea-editor-for';
const TEXTAREA_COPY_FOR_ATTR = 'data-sd-textarea-copy-for';
const TEXTAREA_WRAPPED_ATTR = 'data-sd-textarea-overlay-wrapped';
const TEXTAREA_OVERLAY_WRAPPER_CLASS = 'sdExtensionTextareaOverlayWrapper';
const TEXTAREA_EDITOR_CONTROLS_CLASS = 'sdExtensionTextareaLauncherControls';
const TEXTAREA_COPY_BUTTON_CLASS = 'sdExtensionTextareaCopyButton';
const TEXTAREA_OVERLAY_STYLES_ID = 'sdExtensionTextareaOverlayStyles';

const textareaLayoutBindings = new Map();

let layoutRefreshTimer = null;
let viewportLayoutListenerAttached = false;
let textareaEditorIdCounter = 0;
let unsubscribe = null;
let initialTextareaInjectionTimer = null;

// Roots to search: the document plus every open shadow root. PD designer
// textareas live inside web-component shadow trees, which a plain
// `document.querySelectorAll` cannot reach.
//
// Discovering shadow roots costs a full `*` sweep of the document, so the
// result is cached for the duration of one pass. Previously that sweep ran
// inside `queryAllDeep`, which was itself called once per textarea — making
// the whole scan O(textareas x DOM nodes). On a 40-step method that measured
// 2.1 million node visits for a single DOM mutation.
let cachedRoots = null;

function collectRoots() {
  const roots = [document];
  const stack = [document];
  while (stack.length) {
    const node = stack.pop();
    if (!node.querySelectorAll) continue;
    for (const el of node.querySelectorAll('*')) {
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        stack.push(el.shadowRoot);
      }
    }
  }
  return roots;
}

/** Invalidate the root cache — call once at the start of each pass. */
function beginPass() {
  cachedRoots = null;
}

function queryAllDeep(selector) {
  if (!cachedRoots) cachedRoots = collectRoots();
  const results = [];
  for (const root of cachedRoots) {
    if (!root.querySelectorAll) continue;
    for (const el of root.querySelectorAll(selector)) results.push(el);
  }
  return results;
}

function getTextareaEditorId(textarea) {
  let id = textarea.getAttribute(TEXTAREA_EDITOR_ID_ATTR);
  if (!id) {
    textareaEditorIdCounter += 1;
    id = `sd-textarea-${textareaEditorIdCounter}`;
    textarea.setAttribute(TEXTAREA_EDITOR_ID_ATTR, id);
  }
  return id;
}

function getOverlayWrapperForTextarea(textarea) {
  const parent = textarea?.parentElement;
  if (!parent) return null;
  if (
    parent.classList.contains(TEXTAREA_OVERLAY_WRAPPER_CLASS) &&
    parent.getAttribute(EXTENSION_OWNED_ATTR) === 'true'
  ) {
    return parent;
  }
  return null;
}

// Drop every controls node that is no longer sitting in a valid wrapper
// alongside the textarea it belongs to — the app re-renders and can move a
// textarea out from under its overlay, orphaning the buttons.
//
// This runs ONCE per pass. It used to be a per-textarea deep query, which is
// what made scanning quadratic in page size.
function pruneStaleControls() {
  for (const control of queryAllDeep(`.${TEXTAREA_EDITOR_CONTROLS_CLASS}`)) {
    const textareaId = control.getAttribute(TEXTAREA_EDITOR_FOR_ATTR);
    const wrapper = control.parentElement;
    const attached =
      textareaId &&
      wrapper &&
      wrapper.classList.contains(TEXTAREA_OVERLAY_WRAPPER_CLASS) &&
      wrapper.getAttribute(EXTENSION_OWNED_ATTR) === 'true' &&
      wrapper.querySelector(
        `${TEXTAREA_SELECTOR}[${TEXTAREA_EDITOR_ID_ATTR}="${textareaId}"]`
      );
    if (!attached) control.remove();
  }
}

// Cheap, O(1)-ish check: everything it looks at is scoped to the textarea's
// own wrapper. Orphaned controls elsewhere in the page are handled by
// pruneStaleControls() once per pass rather than re-searched per textarea.
function hasAttachedLauncher(textarea) {
  const textareaId = getTextareaEditorId(textarea);
  const wrapper = getOverlayWrapperForTextarea(textarea);
  if (!wrapper) return false;

  const controls = wrapper.querySelector(
    `.${TEXTAREA_EDITOR_CONTROLS_CLASS}[${TEXTAREA_EDITOR_FOR_ATTR}="${textareaId}"]`
  );
  if (!controls) return false;

  const launcher = controls.querySelector(
    `.${TEXTAREA_EDITOR_LAUNCHER_CLASS}[${TEXTAREA_EDITOR_FOR_ATTR}="${textareaId}"]`
  );
  if (!launcher) {
    controls.remove();
    return false;
  }

  return true;
}

// Inject the overlay stylesheet into `root` — the document, or a shadow root
// when the textarea lives inside a web component (shadow DOM is style-isolated,
// so a document-level <style> would not reach a wrapper inside it).
function ensureOverlayStyles(root = document) {
  const scope = root || document;
  const host = scope === document ? document.head : scope;
  if (!host) return;
  if (scope.querySelector(`#${TEXTAREA_OVERLAY_STYLES_ID}`)) return;

  const styleEl = document.createElement('style');
  styleEl.id = TEXTAREA_OVERLAY_STYLES_ID;
  styleEl.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  styleEl.textContent = `
.${TEXTAREA_OVERLAY_WRAPPER_CLASS} {
  position: relative;
  display: block;
}
.${TEXTAREA_EDITOR_CONTROLS_CLASS} {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  opacity: 0;
  visibility: hidden;
  transition: opacity 140ms ease, visibility 140ms ease;
  z-index: 8;
  pointer-events: none;
}
.${TEXTAREA_OVERLAY_WRAPPER_CLASS}:hover > .${TEXTAREA_EDITOR_CONTROLS_CLASS},
.${TEXTAREA_OVERLAY_WRAPPER_CLASS}:focus-within > .${TEXTAREA_EDITOR_CONTROLS_CLASS} {
  opacity: 1;
  visibility: visible;
}
.${TEXTAREA_EDITOR_CONTROLS_CLASS} .${TEXTAREA_EDITOR_LAUNCHER_CLASS},
.${TEXTAREA_EDITOR_CONTROLS_CLASS} .${TEXTAREA_COPY_BUTTON_CLASS} {
  pointer-events: auto;
}
`;

  host.appendChild(styleEl);
}

function isEligibleTextarea(textarea) {
  if (!textarea || textarea.tagName.toLowerCase() !== 'textarea') return false;

  const closestOwned = textarea.closest(`[${EXTENSION_OWNED_ATTR}]`);
  if (
    closestOwned &&
    !closestOwned.classList.contains(TEXTAREA_OVERLAY_WRAPPER_CLASS)
  ) {
    return false;
  }

  if (hasAttachedLauncher(textarea)) {
    textarea.setAttribute(TEXTAREA_EDITOR_BOUND_ATTR, 'true');
    return false;
  }

  return true;
}

function wrapTextarea(textarea) {
  const existingWrapper = getOverlayWrapperForTextarea(textarea);
  if (existingWrapper) return existingWrapper;
  if (!textarea.parentElement) return null;

  const wrapper = document.createElement('div');
  wrapper.className = TEXTAREA_OVERLAY_WRAPPER_CLASS;
  wrapper.setAttribute(EXTENSION_OWNED_ATTR, 'true');

  textarea.parentElement.insertBefore(wrapper, textarea);
  wrapper.appendChild(textarea);
  textarea.setAttribute(TEXTAREA_WRAPPED_ATTR, 'true');

  return wrapper;
}

/** Read the one measurement control sizing depends on. Forces layout. */
function measureControlSizing(textarea) {
  return textarea ? Math.max(textarea.offsetHeight, 0) : 0;
}

/** Write-only half of the sizing pass — safe to batch after all reads. */
function applyControlSizing(controls, height) {
  if (!controls) return;

  const compact = height > 0 && height < 36;
  const buttonSize = compact ? Math.max(16, Math.min(22, height - 4)) : 28;
  const glyphSize = Math.max(10, Math.round(buttonSize * 0.5));

  const openButton = controls.querySelector(`.${TEXTAREA_EDITOR_LAUNCHER_CLASS}`);
  if (openButton) {
    Object.assign(openButton.style, {
      width: `${buttonSize}px`,
      height: `${buttonSize}px`,
      fontSize: `${Math.max(glyphSize, 11)}px`
    });
  }

  const copyButton = controls.querySelector(`.${TEXTAREA_COPY_BUTTON_CLASS}`);
  if (copyButton) {
    Object.assign(copyButton.style, {
      width: `${buttonSize}px`,
      height: `${buttonSize}px`,
      fontSize: `${Math.max(glyphSize - 1, 10)}px`,
      borderRadius: compact ? '6px' : '8px'
    });
  }
}

function createLauncher(textarea) {
  const textareaId = getTextareaEditorId(textarea);
  const controls = document.createElement('div');
  controls.className = TEXTAREA_EDITOR_CONTROLS_CLASS;
  controls.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  controls.setAttribute(TEXTAREA_EDITOR_FOR_ATTR, textareaId);
  Object.assign(controls.style, {
    position: 'absolute',
    top: '6px',
    right: '6px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '6px'
  });

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = TEXTAREA_EDITOR_LAUNCHER_CLASS;
  openButton.textContent = '⤢';
  openButton.setAttribute('title', 'Open large editor');
  openButton.setAttribute('aria-label', 'Open large editor');
  openButton.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  openButton.setAttribute(TEXTAREA_EDITOR_FOR_ATTR, textareaId);

  Object.assign(openButton.style, PRIMARY_BUTTON_STYLE, {
    width: '28px',
    height: '28px',
    fontSize: '14px'
  });
  applyHoverEffect(openButton, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER);

  openButton.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTextareaEditor(textarea);
  };

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = TEXTAREA_COPY_BUTTON_CLASS;
  copyButton.textContent = '⧉';
  copyButton.setAttribute('title', 'Copy textarea content');
  copyButton.setAttribute('aria-label', 'Copy textarea content');
  copyButton.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  copyButton.setAttribute(TEXTAREA_COPY_FOR_ATTR, textareaId);

  Object.assign(copyButton.style, ICON_BUTTON_STYLE);
  applyHoverEffect(copyButton, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER);

  copyButton.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const textToCopy = textarea.value || '';
    if (!textToCopy.trim()) {
      showToast('Nothing to copy');
      return;
    }

    const copied = await copyText(textToCopy);
    showToast(copied ? 'Textarea copied' : 'Failed to copy textarea');
  };

  controls.appendChild(openButton);
  controls.appendChild(copyButton);

  const existingBinding = textareaLayoutBindings.get(textareaId);
  if (existingBinding?.textarea && existingBinding?.relayout) {
    existingBinding.textarea.removeEventListener('input', existingBinding.relayout);
    existingBinding.textarea.removeEventListener('focus', existingBinding.relayout);
    existingBinding.textarea.removeEventListener('blur', existingBinding.relayout);
  }

  // Single-element relayout — one read then one write, so there is nothing to
  // batch here (the batching matters only for the whole-page pass).
  const relayout = () => {
    applyControlSizing(controls, measureControlSizing(textarea));
  };
  textarea.addEventListener('input', relayout);
  textarea.addEventListener('focus', relayout);
  textarea.addEventListener('blur', relayout);
  textareaLayoutBindings.set(textareaId, { textarea, relayout });

  requestAnimationFrame(relayout);
  return controls;
}

function refreshAllTextareaControlLayouts() {
  beginPass();
  const controlsList = queryAllDeep(`.${TEXTAREA_EDITOR_CONTROLS_CLASS}`);

  // Two phases on purpose. measuring reads offsetHeight (which forces
  // layout) and then writes inline styles (which invalidates it) — doing that
  // per element interleaves read/write and forces a fresh layout for every
  // control on the page. Collecting all measurements first means the browser
  // lays out once for the whole pass.
  const pending = [];
  for (const controls of controlsList) {
    const textareaId = controls.getAttribute(TEXTAREA_EDITOR_FOR_ATTR);
    if (!textareaId) continue;
    // The textarea is a sibling inside the same wrapper — scope the lookup
    // there so it resolves regardless of which (shadow) root it lives in.
    const wrapper = controls.parentElement;
    const textarea =
      wrapper &&
      wrapper.querySelector(
        `${TEXTAREA_SELECTOR}[${TEXTAREA_EDITOR_ID_ATTR}="${textareaId}"]`
      );
    if (!textarea) continue;
    pending.push({ controls, height: Math.max(textarea.offsetHeight, 0) });
  }

  for (const { controls, height } of pending) {
    applyControlSizing(controls, height);
  }
}

function debouncedRefreshAllLayouts() {
  if (layoutRefreshTimer) {
    clearTimeout(layoutRefreshTimer);
  }

  layoutRefreshTimer = setTimeout(() => {
    refreshAllTextareaControlLayouts();
    layoutRefreshTimer = null;
  }, 80);
}

function attachViewportLayoutListener() {
  if (viewportLayoutListenerAttached) return;
  viewportLayoutListenerAttached = true;
  window.addEventListener('resize', debouncedRefreshAllLayouts);
}

function detachViewportLayoutListener() {
  if (!viewportLayoutListenerAttached) return;
  window.removeEventListener('resize', debouncedRefreshAllLayouts);
  viewportLayoutListenerAttached = false;
}

function injectTextareaLaunchers() {
  attachViewportLayoutListener();

  beginPass();
  pruneStaleControls();

  const textareas = queryAllDeep(TEXTAREA_SELECTOR);
  if (textareas.length === 0) return;

  for (const textarea of textareas) {
    if (!isEligibleTextarea(textarea)) continue;
    if (!textarea.parentElement) continue;

    // Overlay styles must live in the textarea's own root (document or the
    // enclosing shadow root) for the wrapper/controls CSS to apply.
    ensureOverlayStyles(textarea.getRootNode());

    const wrapper = wrapTextarea(textarea);
    if (!wrapper) continue;

    wrapper.appendChild(createLauncher(textarea));
    textarea.setAttribute(TEXTAREA_EDITOR_BOUND_ATTR, 'true');
  }

  // Wrapping textareas restructures the DOM, so the cached root list and any
  // layout measurements taken before this point are stale.
  beginPass();
  refreshAllTextareaControlLayouts();
}

function debouncedInjectTextareaLaunchers() {
  if (state.textareaEditorInjectionTimer) {
    clearTimeout(state.textareaEditorInjectionTimer);
  }

  state.textareaEditorInjectionTimer = setTimeout(() => {
    // injectTextareaLaunchers() already ends with a layout refresh — calling
    // it again here just paid for the whole pass twice.
    injectTextareaLaunchers();
  }, 300);
}

function unwrapTextarea(wrapper) {
  if (!wrapper?.parentElement) {
    wrapper?.remove();
    return;
  }

  const textarea = wrapper.querySelector(TEXTAREA_SELECTOR);
  if (!textarea) {
    wrapper.remove();
    return;
  }

  wrapper.parentElement.insertBefore(textarea, wrapper);
  textarea.removeAttribute(TEXTAREA_WRAPPED_ATTR);
  wrapper.remove();
}

export function startTextareaEditorFeature() {
  log('Initializing textarea editor feature...');

  initialTextareaInjectionTimer = setTimeout(() => {
    injectTextareaLaunchers();
  }, 700);

  if (!unsubscribe) {
    unsubscribe = subscribeObserver(() => {
      debouncedInjectTextareaLaunchers();
      debouncedRefreshAllLayouts();
    });
  }

  return stopTextareaEditorFeature;
}

export function stopTextareaEditorFeature() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  if (initialTextareaInjectionTimer) {
    clearTimeout(initialTextareaInjectionTimer);
    initialTextareaInjectionTimer = null;
  }

  if (state.textareaEditorInjectionTimer) {
    clearTimeout(state.textareaEditorInjectionTimer);
    state.textareaEditorInjectionTimer = null;
  }

  if (layoutRefreshTimer) {
    clearTimeout(layoutRefreshTimer);
    layoutRefreshTimer = null;
  }

  detachViewportLayoutListener();
  closeTextareaEditor();

  for (const binding of textareaLayoutBindings.values()) {
    if (!binding?.textarea || !binding?.relayout) continue;
    binding.textarea.removeEventListener('input', binding.relayout);
    binding.textarea.removeEventListener('focus', binding.relayout);
    binding.textarea.removeEventListener('blur', binding.relayout);
  }
  textareaLayoutBindings.clear();

  const controls = queryAllDeep(`.${TEXTAREA_EDITOR_CONTROLS_CLASS}`);
  for (const control of controls) {
    control.remove();
  }

  const wrappers = queryAllDeep(
    `.${TEXTAREA_OVERLAY_WRAPPER_CLASS}[${EXTENSION_OWNED_ATTR}="true"]`
  );
  for (const wrapper of wrappers) {
    unwrapTextarea(wrapper);
  }

  // Remove the overlay <style> from the document and every shadow root.
  for (const styleEl of queryAllDeep(`#${TEXTAREA_OVERLAY_STYLES_ID}`)) {
    styleEl.remove();
  }

  const textareas = queryAllDeep(TEXTAREA_SELECTOR);
  for (const textarea of textareas) {
    textarea.removeAttribute(TEXTAREA_EDITOR_BOUND_ATTR);
    textarea.removeAttribute(TEXTAREA_WRAPPED_ATTR);
  }
}
