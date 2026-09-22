import { DEBUG } from '../../config/constants.js';

// Debug logging utilities
export function log(...args) {
  if (DEBUG) {
    console.log('[SD Extension]', ...args);
  }
}