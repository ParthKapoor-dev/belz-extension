import { state } from '../../core/state.js';
import { extractMethodName, extractPageName } from '../../utils/dom.js';
import { subscribeObserver } from '../../core/observer.js';
import { AD_ROUTE_PREFIX, PD_ROUTE_PREFIX } from '../../config/routes.js';

let unsubscribe = null;

// Title update logic
export function updateTitle() {
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

export function startTitleUpdaterFeature() {
  updateTitle();

  if (!unsubscribe) {
    unsubscribe = subscribeObserver(updateTitle);
  }

  return stopTitleUpdaterFeature;
}

export function stopTitleUpdaterFeature() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
