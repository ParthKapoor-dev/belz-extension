import { DEBUG } from '../../config/constants';

// Debug logging utilities
export function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log('[SD Extension]', ...args);
  }
}