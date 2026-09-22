import { findRunTestButton } from './button-finder';
import { showToast } from '../../ui/toast';

// Run test trigger
export function triggerRunTest(): void {
  const button = findRunTestButton();
  if (!button) return;

  button.click();
  showToast('Run Test triggered');
}