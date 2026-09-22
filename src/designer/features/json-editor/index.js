/*! belz-singleton: designer/features/json-editor/index */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
import { subscribeObserver } from '../../core/observer.js';
import { injectJSONButton } from './injector.js';
import { closeModal } from './modal.js';
import { state } from '../../core/state.js';

let unsubscribe = null;
let initialInjectionTimer = null;

// Main JSON feature coordinator
export function startJSONFeature() {
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

export function stopJSONFeature() {
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
