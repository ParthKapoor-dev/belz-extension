import { AD } from '../../../config/selectors';

// Button selector logic
export function findRunTestButton(): HTMLButtonElement | null {
  for (const selector of AD.runTestButtons) {
    const expButtons = document.querySelectorAll<HTMLElement>(selector);
    for (const exp of expButtons) {
      if (exp.offsetParent === null) continue;

      const innerButton = exp.querySelector<HTMLButtonElement>('button');
      if (innerButton && !innerButton.disabled) {
        return innerButton;
      }
    }
  }
  return null;
}