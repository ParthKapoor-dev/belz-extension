// In-page highlight overlay used by the PD Inspector engine.
//
// The DevTools panel is the UI, but highlighting has to happen on the page
// itself — so the content-script engine owns this small shadow-DOM overlay:
// outline boxes plus a floating label. No panel chrome lives here.
//
// The boxes are `position: fixed` and derived from `getBoundingClientRect()`
// (viewport coords). To stay pinned to the DOM element as the page scrolls,
// the overlay remembers its current target and re-derives those coords on
// every scroll / resize (rAF-throttled).

const CSS = `
:host { all: initial; }
.box {
  position: fixed; pointer-events: none; box-sizing: border-box;
  border: 2px solid #fbbf24; background: rgba(251,191,36,0.12);
  border-radius: 2px;
}
.label {
  position: fixed; pointer-events: none;
  background: #1e1e22; color: #d4d4d8;
  border: 1px solid #fbbf24; border-radius: 5px;
  padding: 5px 8px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  max-width: 360px; box-shadow: 0 3px 10px rgba(0,0,0,0.5);
  white-space: normal; word-break: break-all;
}
.label .t { color: #fbbf24; font-weight: 700; }
.label .s { color: #9ca3af; }
`;

export class Highlighter {
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;
  private readonly label: HTMLDivElement;
  /** Reused box elements. */
  private readonly boxes: HTMLDivElement[] = [];
  private mounted = false;
  /** The element(s) currently highlighted. */
  private current: Element[] | null = null;
  private rafPending = false;

  constructor() {
    this.host = document.createElement('div');
    this.host.id = 'pdi-highlight-host';
    this.host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    this.label = document.createElement('div');
    this.label.className = 'label';
    this.label.style.display = 'none';
    this.root.appendChild(this.label);

    // Capture-phase scroll catches scrolling inside any nested scroll
    // container, not just the document.
    window.addEventListener('scroll', this.onViewportChange, true);
    window.addEventListener('resize', this.onViewportChange);
  }

  /** Outline one or more elements, with a bright title and a dim subtitle. */
  show(elements: Element[], title: string, subtitle?: string): void {
    this.ensureMounted();
    const els = elements.filter(Boolean);
    if (!els.length) {
      this.hide();
      return;
    }
    this.current = els;
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = title;
    this.label.replaceChildren(t);
    if (subtitle) {
      const s = document.createElement('div');
      s.className = 's';
      s.textContent = subtitle;
      this.label.append(s);
    }
    this.label.style.display = 'block';
    this.position();
  }

  hide(): void {
    this.current = null;
    for (const b of this.boxes) b.style.display = 'none';
    this.label.style.display = 'none';
  }

  destroy(): void {
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    if (this.mounted) this.host.remove();
    this.mounted = false;
    this.current = null;
  }

  private ensureMounted(): void {
    if (this.mounted) return;
    document.documentElement.appendChild(this.host);
    this.mounted = true;
  }

  private boxAt(i: number): HTMLDivElement {
    if (!this.boxes[i]) {
      const b = document.createElement('div');
      b.className = 'box';
      this.root.appendChild(b);
      this.boxes[i] = b;
    }
    return this.boxes[i]!;
  }

  // Position the boxes + label over the current elements. `position: fixed`
  // means we re-derive viewport coords here — calling this on scroll keeps the
  // overlay pinned to the DOM element rather than the viewport.
  private position(): void {
    const els = this.current;
    if (!els) return;
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const b = this.boxAt(i);
      b.style.display = 'block';
      b.style.left = `${r.left}px`;
      b.style.top = `${r.top}px`;
      b.style.width = `${r.width}px`;
      b.style.height = `${r.height}px`;
    });
    for (let i = els.length; i < this.boxes.length; i++) {
      this.boxes[i]!.style.display = 'none';
    }

    const first = els[0]!.getBoundingClientRect();
    const lw = this.label.offsetWidth;
    const lh = this.label.offsetHeight;
    let lx = first.left;
    let ly = first.top - lh - 4;
    if (ly < 4) ly = first.top + 4;
    if (lx + lw > window.innerWidth) lx = window.innerWidth - lw - 6;
    this.label.style.left = `${Math.max(4, lx)}px`;
    this.label.style.top = `${Math.max(4, ly)}px`;
  }

  // rAF-throttled reposition for scroll / resize.
  private readonly onViewportChange = (): void => {
    if (this.rafPending || !this.current) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.position();
    });
  };
}
