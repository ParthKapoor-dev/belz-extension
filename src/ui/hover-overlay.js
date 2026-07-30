// A single floating controls element, shared by every matching element on the
// page and positioned over whichever one the pointer or keyboard focus is on.
//
// This is the pattern the textarea editor was rebuilt around, generalised so
// the output-copy feature can use it too. The alternative — a controls node
// injected per match — costs O(matches) elements, restructures the page's own
// markup, and needs a full rescan on every DOM mutation to stay attached. On a
// 40-step Automation Designer method that is the difference between a handful
// of nodes and several hundred, and between reacting to mutations and being a
// major source of them.
//
// What an overlay built here guarantees:
//
//   - injected DOM is O(1) in page size, not O(matches)
//   - the page's markup is never touched: no wrappers, no added classes, no
//     inline position, no marker attributes
//   - no scanning: hover/focus delegation picks up elements added later for
//     free, so features using this need no MutationObserver subscription
//   - only one element is ever measured or positioned

import { EXTENSION_OWNED_ATTR } from '../config/constants.js';
import { applyHoverEffect } from './styles.js';

/** Keep the overlay up briefly so the pointer can travel onto the buttons. */
const HIDE_GRACE_MS = 120;
/** Re-arm points, in ms after start — spanning a slow SPA bootstrap. */
const REARM_DELAYS_MS = [1000, 3000, 6000];

const DEFAULT_BUTTON_SIZE = 28;

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

/**
 * @param {object} config
 * @param {string} config.id                   Element id for the controls node.
 * @param {string} config.label                Name used in diagnostic logging.
 * @param {(node: Element) => Element|null} config.resolveTarget
 *        Given the element under the pointer, return the element the overlay
 *        should attach to, or null if it should not appear.
 * @param {Array<object>} config.buttons       Button descriptors, top to bottom.
 * @param {(rect: DOMRect) => object} [config.sizeFor]
 *        Optional sizing hook; returns { buttonSize, glyphSize, compact }.
 * @param {number} [config.inset]              Gap from the target's top-right.
 */
export function createHoverOverlay(config) {
  const inset = config.inset == null ? 6 : config.inset;
  const sizeFor = config.sizeFor || (() => ({
    buttonSize: DEFAULT_BUTTON_SIZE,
    glyphSize: Math.round(DEFAULT_BUTTON_SIZE * 0.5),
    compact: false
  }));

  let controlsEl = null;
  let buttonEls = [];

  let activeTarget = null;
  let hideTimer = null;
  let repositionScheduled = false;
  let repositionTimer = null;
  let listenersAttached = false;
  /** The document the delegation is currently registered on. */
  let attachedDocument = null;
  const rearmTimers = [];
  let started = false;
  let loggedAttach = false;

  // ---- the shared overlay -------------------------------------------------

  function buildControls() {
    const controls = document.createElement('div');
    controls.id = config.id;
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

    buttonEls = config.buttons.map((spec) => {
      const button = document.createElement('button');
      button.type = 'button';
      if (spec.className) button.className = spec.className;
      button.textContent = spec.glyph;
      button.setAttribute('title', spec.title);
      button.setAttribute('aria-label', spec.title);
      button.setAttribute(EXTENSION_OWNED_ATTR, 'true');
      Object.assign(button.style, spec.style, {
        width: `${DEFAULT_BUTTON_SIZE}px`,
        height: `${DEFAULT_BUTTON_SIZE}px`
      });
      if (spec.hover) applyHoverEffect(button, spec.hover[0], spec.hover[1]);

      // Clicking a button must not pull focus out of the target — otherwise
      // the caret position an editor would restore is already lost.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (activeTarget) spec.onClick(activeTarget);
      });

      controls.appendChild(button);
      return { el: button, spec };
    });

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

  // ---- positioning --------------------------------------------------------

  function position() {
    if (!activeTarget || !controlsEl) return;

    if (!activeTarget.isConnected) {
      hide();
      return;
    }

    // One read of the target's box drives both sizing and placement.
    const rect = activeTarget.getBoundingClientRect();

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

    const size = sizeFor(rect);

    for (const { el, spec } of buttonEls) {
      Object.assign(el.style, {
        width: `${size.buttonSize}px`,
        height: `${size.buttonSize}px`,
        fontSize: `${Math.max(size.glyphSize, 10)}px`
      });
      if (spec.adjust) spec.adjust(el, size);
    }

    Object.assign(controlsEl.style, {
      display: 'flex',
      top: `${Math.max(rect.top + inset, inset)}px`,
      left: `${rect.right - inset - size.buttonSize}px`
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
    if (repositionScheduled || !activeTarget) return;
    repositionScheduled = true;
    requestAnimationFrame(runReposition);
    repositionTimer = setTimeout(runReposition, 32);
  }

  function show(target) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    activeTarget = target;
    if (!ensureControls()) return;
    position();
  }

  function hide() {
    activeTarget = null;
    if (controlsEl) controlsEl.style.display = 'none';
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hide();
    }, HIDE_GRACE_MS);
  }

  // ---- delegated events ---------------------------------------------------
  // All of these are document-level and capture-phase, so an element that
  // appears later needs no registration of any kind.

  function resolve(node) {
    if (!node || node.nodeType !== 1) return null;
    // Never decorate anything inside our own UI (the modals, another overlay).
    if (node.closest && node.closest(`[${EXTENSION_OWNED_ATTR}]`)) return null;
    return config.resolveTarget(node);
  }

  function onPointerOver(event) {
    const target = realTarget(event);
    if (controlsEl && controlsEl.contains(target)) {
      // Moving onto the buttons themselves keeps the current target active.
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      return;
    }
    const resolved = resolve(target);
    if (resolved) {
      show(resolved);
      return;
    }
    if (activeTarget) scheduleHide();
  }

  function onFocusIn(event) {
    const resolved = resolve(realTarget(event));
    if (resolved) show(resolved);
  }

  function onFocusOut(event) {
    if (realTarget(event) === activeTarget) scheduleHide();
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
    if (realTarget(event) === activeTarget) scheduleReposition();
  }

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    attachedDocument = document;
    if (!loggedAttach) {
      loggedAttach = true;
      console.log(`[belz] ${config.label}: listeners attached`);
    }
    document.addEventListener('mouseover', onPointerOver, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
  }

  function detachListeners() {
    if (!listenersAttached) return;
    listenersAttached = false;
    document.removeEventListener('mouseover', onPointerOver, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
  }

  // Re-register the delegation from scratch. The host SPA bootstraps after our
  // content script runs (document_idle), and listeners registered before that
  // point were observed never to receive events, while identical ones
  // registered afterwards work — which is exactly what toggling the feature off
  // and on was doing by hand. Re-arming a few times over the first seconds, and
  // on the document lifecycle events, covers it without depending on why.
  function rearmListeners() {
    if (!started) return;
    if (attachedDocument !== document) {
      console.log(`[belz] ${config.label}: document was replaced — re-arming`);
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

  // ---- lifecycle ----------------------------------------------------------

  function start() {
    // Listeners FIRST, and never behind a guard that can be left half-set.
    //
    // These are the whole overlay: the controls node is created lazily on the
    // first hover. Building it here instead meant that if the host app had not
    // settled its <body> yet — this runs at document_idle, while an SPA is
    // still bootstrapping — the append could throw and take attachListeners()
    // with it, leaving the feature permanently dead until something called
    // stop()/start() again. Toggling the setting off and on was the only way
    // back.
    started = true;
    attachListeners();
    scheduleRearms();
  }

  function stop() {
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

    activeTarget = null;
    if (controlsEl) {
      controlsEl.remove();
      controlsEl = null;
      buttonEls = [];
    }
  }

  return { start, stop, getActive: () => activeTarget };
}
