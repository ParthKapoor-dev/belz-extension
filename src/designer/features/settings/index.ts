// Settings entry points on designer pages: a ⚙ button in the header,
// Ctrl+, / Alt+, and the browser-level command relayed by the background.
// Always on: bootstrap starts it regardless of settings.
import { EXTENSION_OWNED_ATTR, ns } from '../../../config/namespace';
import { HEADER } from '../../../config/selectors';
import { TIMINGS } from '../../../config/timings';
import { settingsModal } from './modal';
import { pageObserver } from '../../core/observer';
import { PRIMARY_BUTTON_STYLE } from '../../ui/styles';
import { isOpenSettings } from '../../../shared/messages';
import { createLogger } from '../../../shared/logger';

const log = createLogger('settings-ui');

const SETTINGS_BUTTON_ID = ns('SettingsButton');

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

  pageTitle.appendChild(createSettingsButton(onOpen));
  return true;
}

/** Always on for the life of the page: the way back to turning features on. */
export class SettingsLauncher {
  private debounce: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    setTimeout(() => injectSettingsButton(this.open), TIMINGS.settingsButtonFirstTry);
    // The AD app re-renders its header; put the button back when it goes.
    pageObserver.subscribe(() => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => injectSettingsButton(this.open), TIMINGS.settingsButtonDebounce);
    });

    document.addEventListener('keydown', this.onKeydown, true);
    chrome.runtime?.onMessage?.addListener(this.onMessage);
  }

  private readonly open = (): void => settingsModal.open();

  // Ctrl+, is the conventional chord, but Firefox and Zen bind it to their own
  // preferences and consume it before the page sees a keydown — so Alt+, is
  // accepted as an equivalent that no browser claims. The browser-level
  // command (Alt+Shift+S by default, and remappable) covers it either way;
  // see the open-settings handler in src/background/index.ts.
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.shiftKey || event.metaKey) return;
    if (event.key !== ',' && event.code !== 'Comma') return;
    // Exactly one of Ctrl / Alt — not both, not neither.
    if (event.ctrlKey === event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    this.open();
  };

  // Relay from the browser command, for when the chord never reaches the page.
  private readonly onMessage = (message: unknown): void => {
    if (isOpenSettings(message)) this.open();
  };
}
