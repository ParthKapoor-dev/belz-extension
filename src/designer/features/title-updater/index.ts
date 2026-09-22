/*! belz-singleton: designer/features/title-updater/index */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
import { state } from '../../core/state';
import { extractMethodName, extractPageName } from '../../utils/dom';
import { subscribeObserver } from '../../core/observer';
import { AD_ROUTE_PREFIX, PD_ROUTE_PREFIX } from '../../../config/routes';

let unsubscribe: (() => void) | null = null;

// Title update logic
export function updateTitle(): void {
  const pathname = window.location.pathname;
  let name = null;
  let prefix = '';

  if (pathname.startsWith(AD_ROUTE_PREFIX)) {
    name = extractMethodName();
    prefix = 'AD';
  } else if (pathname.startsWith(PD_ROUTE_PREFIX)) {
    name = extractPageName();
    prefix = 'PD';
  }

  if (!name || name === state.lastMethodName) return;

  state.lastMethodName = name;
  document.title = `${prefix}: ${name}`;
}

export function startTitleUpdaterFeature(): () => void {
  updateTitle();

  if (!unsubscribe) {
    unsubscribe = subscribeObserver(updateTitle);
  }

  return stopTitleUpdaterFeature;
}

export function stopTitleUpdaterFeature(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
