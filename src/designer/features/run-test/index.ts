// Run Test: find AD's Run Test button and click it, for the Ctrl+Shift+Enter
// shortcut.
import { AD } from '../../../config/selectors';
import { toast } from '../../ui/toast';

/** The visible, enabled Run Test button, or null. */
export function findRunTestButton(): HTMLButtonElement | null {
  for (const selector of AD.runTestButtons) {
    for (const host of document.querySelectorAll<HTMLElement>(selector)) {
      if (host.offsetParent === null) continue;
      const inner = host.querySelector<HTMLButtonElement>('button');
      if (inner && !inner.disabled) return inner;
    }
  }
  return null;
}

export function triggerRunTest(): void {
  const button = findRunTestButton();
  if (!button) return;
  button.click();
  toast.show('Run Test triggered');
}
