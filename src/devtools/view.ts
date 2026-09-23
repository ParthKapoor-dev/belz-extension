// DOM helpers shared by the DevTools panels (AD Network, PD Inspector).

import { TIMINGS } from '../config/timings';

type Kid = Node | string | number | null | undefined;

/** A new element with `props` assigned and `kids` appended (strings as text). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]> | null,
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) Object.assign(node, props);
  for (const k of kids) {
    if (k == null) continue;
    node.append(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
  return node;
}

/** The class both panels style as the focus-shortcut pulse. */
const FOCUS_FLASH_CLASS = 'focus-flash';
/**
 * The CSS custom property that carries the pulse length to the panels' CSS
 * (`animation: focus-pulse var(--focus-flash-ms) …`), so TIMINGS is the only
 * place the number lives.
 */
const FOCUS_FLASH_VAR = '--focus-flash-ms';

/**
 * The focus shortcut's pulse: adds `focus-flash` to an element for
 * TIMINGS.panelFocusFlash, and sets FOCUS_FLASH_VAR on it so the CSS
 * animation lasts exactly as long. One pulse at a time; cancel() ends it
 * early, so a panel's stop() leaves no timer behind.
 */
export class FocusFlash {
  private target: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(target: HTMLElement): void {
    this.cancel();
    this.target = target;
    target.style.setProperty(FOCUS_FLASH_VAR, `${TIMINGS.panelFocusFlash}ms`);
    target.classList.add(FOCUS_FLASH_CLASS);
    this.timer = setTimeout(this.cancel, TIMINGS.panelFocusFlash);
  }

  readonly cancel = (): void => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.target?.classList.remove(FOCUS_FLASH_CLASS);
    this.target?.style.removeProperty(FOCUS_FLASH_VAR);
    this.target = null;
  };
}
