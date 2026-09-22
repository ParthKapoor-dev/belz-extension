/*! belz-singleton: designer/features/json-editor/index */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
import { subscribeObserver } from '../../core/observer';
import { injectJSONButton } from './injector';
import { closeModal } from './modal';
import { state } from '../../core/state';

let unsubscribe: (() => void) | null = null;
let initialInjectionTimer: ReturnType<typeof setTimeout> | null = null;

// Main JSON feature coordinator
export function startJSONFeature(): () => void {
  console.log('Initializing JSON feature...');

  initialInjectionTimer = setTimeout(() => {
    injectJSONButton();
  }, 1000);

  if (!unsubscribe) {
    unsubscribe = subscribeObserver(() => {
      injectJSONButton();
    });
  }

  console.log('JSON feature initialized');
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

  const jsonButton = document.getElementById('sdExtensionJSONButton');
  if (jsonButton) {
    jsonButton.remove();
  }

  state.jsonButtonEl = null;
}
