// A single floating controls element, shared by every matching element on the
// page and positioned over whichever one the pointer or keyboard focus is on.
//
// This is the pattern the IDE was rebuilt around, generalised so
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

import { EXTENSION_OWNED_ATTR } from '../../config/namespace';
import { applyHoverEffect, type StyleMap } from './styles';
import { Rearm } from '../core/rearm';
import { createLogger } from '../../shared/logger';

const log = createLogger('hover-overlay');

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

/** Keep the overlay up briefly so the pointer can travel onto the buttons. */
const HIDE_GRACE_MS = 120;

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

export class HoverOverlay<T extends HTMLElement> {
  private readonly inset: number;
  private readonly sizeFor: (rect: DOMRect) => OverlaySize;

  private controlsEl: HTMLDivElement | null = null;
  private buttonEls: Array<{ el: HTMLButtonElement; spec: OverlayButton<T> }> = [];

  private activeTarget: T | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private repositionScheduled = false;
  private repositionTimer: ReturnType<typeof setTimeout> | null = null;
  private listenersAttached = false;
  /** The document the delegation is currently registered on. */
  private attachedDocument: Document | null = null;
  private loggedAttach = false;
  /** Re-registers the delegation while the host app boots; see core/rearm.ts. */
  private readonly rearm = new Rearm(() => {
    if (this.attachedDocument !== document) {
      log.debug(`${this.config.label}: document was replaced — re-arming`);
    }
    this.detachListeners();
    this.attachListeners();
  });

  constructor(private readonly config: HoverOverlayConfig<T>) {
    this.inset = config.inset ?? 6;
    this.sizeFor = config.sizeFor ?? ((): OverlaySize => ({
      buttonSize: DEFAULT_BUTTON_SIZE,
      glyphSize: Math.round(DEFAULT_BUTTON_SIZE * 0.5),
      compact: false
    }));
  }

  /** The element the overlay is attached to right now, if any. */
  get active(): T | null {
    return this.activeTarget;
  }

  // ---- lifecycle ----------------------------------------------------------

  start(): void {
    // Listeners FIRST, and never behind a guard that can be left half-set.
    //
    // These are the whole overlay: the controls node is created lazily on the
    // first hover. Building it here instead meant that if the host app had not
    // settled its <body> yet — this runs at document_idle, while an SPA is
    // still bootstrapping — the append could throw and take attachListeners()
    // with it, leaving the feature permanently dead until something called
    // stop()/start() again. Toggling the setting off and on was the only way
    // back.
    this.attachListeners();
    this.rearm.start();
  }

  stop(): void {
    this.rearm.stop();
    this.detachListeners();

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (this.repositionTimer) clearTimeout(this.repositionTimer);
    this.repositionTimer = null;
    this.repositionScheduled = false;

    this.activeTarget = null;
    this.controlsEl?.remove();
    this.controlsEl = null;
    this.buttonEls = [];
  }

  // ---- the shared overlay -------------------------------------------------

  private buildControls(): HTMLDivElement {
    const controls = document.createElement('div');
    controls.id = this.config.id;
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

    this.buttonEls = this.config.buttons.map((spec) => {
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
        if (this.activeTarget) spec.onClick(this.activeTarget);
      });

      controls.appendChild(button);
      return { el: button, spec };
    });

    return controls;
  }

  private ensureControls(): HTMLDivElement | null {
    if (this.controlsEl && this.controlsEl.isConnected) return this.controlsEl;
    // The host app wipes and re-renders the body on route changes, which takes
    // our overlay with it — rebuild rather than assume it survived.
    const host = document.body || document.documentElement;
    if (!host) return null;
    this.controlsEl = this.buildControls();
    host.appendChild(this.controlsEl);
    return this.controlsEl;
  }

  // ---- positioning --------------------------------------------------------

  private position(): void {
    const target = this.activeTarget;
    const controls = this.controlsEl;
    if (!target || !controls) return;

    if (!target.isConnected) {
      this.hide();
      return;
    }

    // One read of the target's box drives both sizing and placement.
    const rect = target.getBoundingClientRect();

    // Scrolled out of view (or collapsed) — nothing to hover.
    const offscreen =
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight ||
      rect.right <= 0 ||
      rect.left >= window.innerWidth ||
      rect.width === 0 ||
      rect.height === 0;
    if (offscreen) {
      controls.style.display = 'none';
      return;
    }

    const size = this.sizeFor(rect);

    for (const { el, spec } of this.buttonEls) {
      Object.assign(el.style, {
        width: `${size.buttonSize}px`,
        height: `${size.buttonSize}px`,
        fontSize: `${Math.max(size.glyphSize, 10)}px`
      });
      if (spec.adjust) spec.adjust(el, size);
    }

    Object.assign(controls.style, {
      display: 'flex',
      top: `${Math.max(rect.top + this.inset, this.inset)}px`,
      left: `${rect.right - this.inset - size.buttonSize}px`
    });
  }

  private readonly runReposition = (): void => {
    if (!this.repositionScheduled) return; // the other scheduler already handled it
    this.repositionScheduled = false;
    if (this.repositionTimer) clearTimeout(this.repositionTimer);
    this.repositionTimer = null;
    this.position();
  };

  // Coalesce a burst of scroll/resize/input events into one reposition.
  //
  // requestAnimationFrame is the right primitive — it runs just before paint,
  // after layout has settled — but it is suspended entirely in some contexts
  // (backgrounded tabs, headless rendering). A short timeout backstop means a
  // missing frame can never leave the overlay floating over the wrong element.
  // Whichever fires first wins; the flag stops the other from repeating it.
  private scheduleReposition(): void {
    if (this.repositionScheduled || !this.activeTarget) return;
    this.repositionScheduled = true;
    requestAnimationFrame(this.runReposition);
    this.repositionTimer = setTimeout(this.runReposition, 32);
  }

  private show(target: T): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.activeTarget = target;
    if (!this.ensureControls()) return;
    this.position();
  }

  private hide(): void {
    this.activeTarget = null;
    if (this.controlsEl) this.controlsEl.style.display = 'none';
  }

  private scheduleHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.hide();
    }, HIDE_GRACE_MS);
  }

  // ---- delegated events ---------------------------------------------------
  // All of these are document-level and capture-phase, so an element that
  // appears later needs no registration of any kind. They are arrow
  // properties so add/removeEventListener always see the same function.

  // `event` is forwarded so a resolver can hit-test the pointer position.
  // That is the only way to reach a `disabled` control, which receives no
  // pointer events of its own — see resolveTextarea in the IDE.
  private resolve(node: EventTarget | null, event: Event): T | null {
    // A nodeType check, not `instanceof Element`: an element from another
    // frame, or seen through Firefox's content-script wrappers, can fail
    // instanceof against this world's Element and still be an element.
    if (!node || (node as Node).nodeType !== 1) return null;
    const element = node as Element;
    // Never decorate anything inside our own UI (the modals, another overlay).
    if (element.closest(`[${EXTENSION_OWNED_ATTR}]`)) return null;
    return this.config.resolveTarget(element, event);
  }

  private readonly onPointerOver = (event: Event): void => {
    const target = realTarget(event);
    if (this.controlsEl && target && this.controlsEl.contains(target as Node)) {
      // Moving onto the buttons themselves keeps the current target active.
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = null;
      return;
    }
    const resolved = this.resolve(target, event);
    if (resolved) {
      this.show(resolved);
      return;
    }
    if (this.activeTarget) this.scheduleHide();
  };

  private readonly onFocusIn = (event: Event): void => {
    const resolved = this.resolve(realTarget(event), event);
    if (resolved) this.show(resolved);
  };

  private readonly onFocusOut = (event: Event): void => {
    if (realTarget(event) === this.activeTarget) this.scheduleHide();
  };

  // Capture phase, so this also fires for scrollable containers, not just the
  // window. Cheap because only one element is ever repositioned.
  private readonly onScrollOrResize = (): void => {
    this.scheduleReposition();
  };

  private readonly onInput = (event: Event): void => {
    // Auto-growing textareas change height as the user types.
    if (realTarget(event) === this.activeTarget) this.scheduleReposition();
  };

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    this.attachedDocument = document;
    if (!this.loggedAttach) {
      this.loggedAttach = true;
      log.debug(`${this.config.label}: listeners attached`);
    }
    document.addEventListener('mouseover', this.onPointerOver, true);
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('focusout', this.onFocusOut, true);
    document.addEventListener('input', this.onInput, true);
    document.addEventListener('scroll', this.onScrollOrResize, true);
    window.addEventListener('resize', this.onScrollOrResize);
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return;
    this.listenersAttached = false;
    document.removeEventListener('mouseover', this.onPointerOver, true);
    document.removeEventListener('focusin', this.onFocusIn, true);
    document.removeEventListener('focusout', this.onFocusOut, true);
    document.removeEventListener('input', this.onInput, true);
    document.removeEventListener('scroll', this.onScrollOrResize, true);
    window.removeEventListener('resize', this.onScrollOrResize);
  }
}
