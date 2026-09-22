/*! belz-singleton: designer/features/json-editor/index */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
import { subscribeObserver } from '../../core/observer';
import { injectJSONButton, JSON_BUTTON_ID } from './injector';
import { closeModal } from './modal';
import { state } from '../../core/state';
import { TIMINGS } from '../../../config/timings';
import { createLogger } from '../../../shared/logger';

const log = createLogger('json-editor');

let unsubscribe: (() => void) | null = null;
let initialInjectionTimer: ReturnType<typeof setTimeout> | null = null;

// Main JSON feature coordinator
export function startJSONFeature(): () => void {
  log.debug('Initializing JSON feature...');

  initialInjectionTimer = setTimeout(() => {
    injectJSONButton();
  }, TIMINGS.jsonButtonFirstTry);

  if (!unsubscribe) {
    unsubscribe = subscribeObserver(() => {
      injectJSONButton();
    });
  }

  log.debug('JSON feature initialized');
  return stopJSONFeature;
}

export function stopJSONFeature(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  if (initialInjectionTimer) {
    clearTimeout(initialInjectionTimer);
    initialInjectionTimer = null;
  }

  closeModal();

  const jsonButton = document.getElementById(JSON_BUTTON_ID);
  if (jsonButton) {
    jsonButton.remove();
  }

  state.jsonButtonEl = null;
}
