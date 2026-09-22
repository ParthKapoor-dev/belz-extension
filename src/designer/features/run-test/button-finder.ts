import { RUN_TEST_EXP_BUTTON_SELECTORS } from '../../../config/constants';

// Button selector logic
export function findRunTestButton(): HTMLButtonElement | null {
  for (const selector of RUN_TEST_EXP_BUTTON_SELECTORS) {
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