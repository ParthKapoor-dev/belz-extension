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

import { EXTENSION_OWNED_ATTR } from '../../config/constants';
import { applyHoverEffect, type StyleMap } from './styles';

/** Button dimensions for one target, from the optional `sizeFor` hook. */
export interface OverlaySize {
  buttonSize: number;
  glyphSize: number;
  compact: boolean;
}

/** One button of the floating controls, top to bottom. */
export interface OverlayButton<T extends HTMLElement> {
  className?: string;
  /** The button's text: a single glyph. */
  glyph: string;
  /** Tooltip and accessible label. */
  title: string;
  style: StyleMap;
  /** [style on hover, style when the pointer leaves]. */
  hover?: [StyleMap, StyleMap];
  /** Per-target tweaks after the default sizing. */
  adjust?: (el: HTMLButtonElement, size: OverlaySize) => void;
  onClick: (target: T) => void;
}

export interface HoverOverlayConfig<T extends HTMLElement> {
  /** Element id for the controls node. */
  id: string;
  /** Name used in diagnostic logging. */
  label: string;
  /**
   * Given the element under the pointer, return the element the overlay
   * should attach to, or null if it should not appear. The originating event
   * is passed too, for resolvers that need to hit-test.
   */
  resolveTarget: (node: Element, event: Event) => T | null;
  buttons: OverlayButton<T>[];
  sizeFor?: (rect: DOMRect) => OverlaySize;
  /** Gap from the target's top-right corner, in px. */
  inset?: number;
}

export interface HoverOverlay<T extends HTMLElement> {
  start(): void;
  stop(): void;
  getActive(): T | null;
}

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
function realTarget(event: Event): EventTarget | null {
  if (typeof event.composedPath === 'function') {
    const path = event.composedPath();
    if (path.length) return path[0] ?? null;
  }
  return event.target;
}

export function createHoverOverlay<T extends HTMLElement>(
  config: HoverOverlayConfig<T>
): HoverOverlay<T> {
  const inset = config.inset == null ? 6 : config.inset;
  const sizeFor = config.sizeFor || ((): OverlaySize => ({
    buttonSize: DEFAULT_BUTTON_SIZE,
    glyphSize: Math.round(DEFAULT_BUTTON_SIZE * 0.5),
    compact: false
  }));

  let controlsEl: HTMLDivElement | null = null;
  let buttonEls: Array<{ el: HTMLButtonElement; spec: OverlayButton<T> }> = [];

  let activeTarget: T | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let repositionScheduled = false;
  let repositionTimer: ReturnType<typeof setTimeout> | null = null;
  let listenersAttached = false;
  /** The document the delegation is currently registered on. */
  let attachedDocument: Document | null = null;
  const rearmTimers: Array<ReturnType<typeof setTimeout>> = [];
  let started = false;
  let loggedAttach = false;

  // ---- the shared overlay -------------------------------------------------

  function buildControls(): HTMLDivElement {
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

  function ensureControls(): HTMLDivElement | null {
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

  function position(): void {
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

  function runReposition(): void {
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
  function scheduleReposition(): void {
    if (repositionScheduled || !activeTarget) return;
    repositionScheduled = true;
    requestAnimationFrame(runReposition);
    repositionTimer = setTimeout(runReposition, 32);
  }

  function show(target: T): void {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    activeTarget = target;
    if (!ensureControls()) return;
    position();
  }

  function hide(): void {
    activeTarget = null;
    if (controlsEl) controlsEl.style.display = 'none';
  }

  function scheduleHide(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hide();
    }, HIDE_GRACE_MS);
  }

  // ---- delegated events ---------------------------------------------------
  // All of these are document-level and capture-phase, so an element that
  // appears later needs no registration of any kind.

  // `event` is forwarded so a resolver can hit-test the pointer position.
  // That is the only way to reach a `disabled` control, which receives no
  // pointer events of its own — see resolveTextarea in the textarea editor.
  function resolve(node: EventTarget | null, event: Event): T | null {
    // A nodeType check, not `instanceof Element`: an element from another
    // frame, or seen through Firefox's content-script wrappers, can fail
    // instanceof against this world's Element and still be an element.
    if (!node || (node as Node).nodeType !== 1) return null;
    const element = node as Element;
    // Never decorate anything inside our own UI (the modals, another overlay).
    if (element.closest(`[${EXTENSION_OWNED_ATTR}]`)) return null;
    return config.resolveTarget(element, event);
  }

  function onPointerOver(event: Event): void {
    const target = realTarget(event);
    if (controlsEl && target && controlsEl.contains(target as Node)) {
      // Moving onto the buttons themselves keeps the current target active.
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      return;
    }
    const resolved = resolve(target, event);
    if (resolved) {
      show(resolved);
      return;
    }
    if (activeTarget) scheduleHide();
  }

  function onFocusIn(event: Event): void {
    const resolved = resolve(realTarget(event), event);
    if (resolved) show(resolved);
  }

  function onFocusOut(event: Event): void {
    if (realTarget(event) === activeTarget) scheduleHide();
  }

  function onScroll(): void {
    // Capture phase, so this also fires for scrollable containers, not just the
    // window. Cheap because only one element is ever repositioned.
    scheduleReposition();
  }

  function onResize(): void {
    scheduleReposition();
  }

  function onInput(event: Event): void {
    // Auto-growing textareas change height as the user types.
    if (realTarget(event) === activeTarget) scheduleReposition();
  }

  function attachListeners(): void {
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

  function detachListeners(): void {
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
  function rearmListeners(): void {
    if (!started) return;
    if (attachedDocument !== document) {
      console.log(`[belz] ${config.label}: document was replaced — re-arming`);
    }
    detachListeners();
    attachListeners();
  }

  function scheduleRearms(): void {
    for (const delay of REARM_DELAYS_MS) {
      rearmTimers.push(setTimeout(rearmListeners, delay));
    }
    window.addEventListener('load', rearmListeners);
    window.addEventListener('pageshow', rearmListeners);
  }

  function cancelRearms(): void {
    for (const timer of rearmTimers) clearTimeout(timer);
    rearmTimers.length = 0;
    window.removeEventListener('load', rearmListeners);
    window.removeEventListener('pageshow', rearmListeners);
  }

  // ---- lifecycle ----------------------------------------------------------

  function start(): void {
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

  function stop(): void {
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
