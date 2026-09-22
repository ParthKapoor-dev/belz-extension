/*! belz-singleton: designer/features/settings/index */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
import { EXTENSION_OWNED_ATTR, ns } from '../../../config/namespace';
import { HEADER } from '../../../config/selectors';
import { TIMINGS } from '../../../config/timings';
import { hideSettingsModal, openSettingsModal } from './modal';
import { subscribeObserver } from '../../core/observer';
import { PRIMARY_BUTTON_STYLE } from '../../ui/styles';
import { isOpenSettings } from '../../../shared/messages';
import type { Settings } from '../../../config/settings';
import { createLogger } from '../../../shared/logger';

const log = createLogger('settings');

const SETTINGS_BUTTON_ID = ns('SettingsButton');

/** How the settings UI reads and writes settings. */
export interface SettingsAccess {
  getSettings: () => Settings;
  setSetting: (key: string, value: unknown) => void;
}

let unsubscribe: (() => void) | null = null;
let settingsInjectionTimer: ReturnType<typeof setTimeout> | null = null;
let settingsInitialTimer: ReturnType<typeof setTimeout> | null = null;
let settingsShortcutHandler: ((event: KeyboardEvent) => void) | null = null;
let settingsCommandListener: ((message: unknown) => void) | null = null;

function createSettingsButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = SETTINGS_BUTTON_ID;
  button.type = 'button';
  button.textContent = '⚙';
  button.setAttribute('title', 'Open extension settings');
  button.setAttribute('aria-label', 'Open extension settings');
  button.setAttribute(EXTENSION_OWNED_ATTR, 'true');

  Object.assign(button.style, PRIMARY_BUTTON_STYLE, {
    width: '30px',
    height: '30px',
    marginLeft: '8px',
    fontSize: '16px',
    lineHeight: '1',
    borderRadius: '50%'
  });

  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  };

  return button;
}

function injectSettingsButton(onOpen: () => void): boolean {
  if (document.getElementById(SETTINGS_BUTTON_ID)) {
    return true;
  }

  const headerBanner = document.querySelector(HEADER.banner);
  if (!headerBanner) {
    log.debug('Settings injection skipped: no header banner', HEADER.banner);
    return false;
  }

  const button = createSettingsButton(onOpen);
  const pageTitle = headerBanner.querySelector<HTMLElement>(HEADER.title);
  if (!pageTitle) {
    log.debug('Settings injection skipped: no title in the header banner', HEADER.title);
    return false;
  }

  if (pageTitle.style.display !== 'flex') {
    Object.assign(pageTitle.style, {
      display: 'flex',
      alignItems: 'center'
    });
  }

  pageTitle.appendChild(button);
  return true;
}

function debouncedInjectSettingsButton(onOpen: () => void): void {
  if (settingsInjectionTimer) {
    clearTimeout(settingsInjectionTimer);
  }

  settingsInjectionTimer = setTimeout(() => {
    injectSettingsButton(onOpen);
  }, TIMINGS.settingsButtonDebounce);
}

export function startSettingsFeature({ getSettings, setSetting }: SettingsAccess): () => void {
  const openSettings = () => openSettingsModal({ getSettings, setSetting });

  settingsInitialTimer = setTimeout(() => {
    injectSettingsButton(openSettings);
  }, TIMINGS.settingsButtonFirstTry);

  if (!unsubscribe) {
    unsubscribe = subscribeObserver(() => {
      debouncedInjectSettingsButton(openSettings);
    });
  }

  // Ctrl+, is the conventional chord, but Firefox and Zen bind it to their own
  // preferences and consume it before the page sees a keydown — so Alt+, is
  // accepted as an equivalent that no browser claims. The browser-level
  // command (Alt+Shift+S by default, and remappable) covers it either way;
  // see the open-settings handler in src/background/index.js.
  settingsShortcutHandler = (event) => {
    if (event.shiftKey || event.metaKey) return;
    if (event.key !== ',' && event.code !== 'Comma') return;
    // Exactly one of Ctrl / Alt — not both, not neither.
    if (event.ctrlKey === event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    openSettings();
  };

  document.addEventListener('keydown', settingsShortcutHandler, true);

  // Relay from the browser command, for when the chord never reaches the page.
  settingsCommandListener = (message: unknown) => {
    if (isOpenSettings(message)) openSettings();
  };
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(settingsCommandListener);
  }

  return stopSettingsFeature;
}

export function stopSettingsFeature(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  if (settingsInjectionTimer) {
    clearTimeout(settingsInjectionTimer);
    settingsInjectionTimer = null;
  }

  if (settingsInitialTimer) {
    clearTimeout(settingsInitialTimer);
    settingsInitialTimer = null;
  }

  if (settingsShortcutHandler) {
    document.removeEventListener('keydown', settingsShortcutHandler, true);
    settingsShortcutHandler = null;
  }

  if (settingsCommandListener) {
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.removeListener(settingsCommandListener);
    }
    settingsCommandListener = null;
  }

  hideSettingsModal();

  const settingsButton = document.getElementById(SETTINGS_BUTTON_ID);
  if (settingsButton) {
    settingsButton.remove();
  }
}
