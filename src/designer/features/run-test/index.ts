import { findRunTestButton } from './button-finder';
import { toast } from '../../ui/toast';

// Run test trigger
export function triggerRunTest(): void {
  const button = findRunTestButton();
  if (!button) return;

  button.click();
  toast.show('Run Test triggered');
}