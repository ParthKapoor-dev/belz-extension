// Settings entry points on designer pages: a ⚙ button in the header,
// Ctrl+, / Alt+, and the browser-level command relayed by the background.
// Always on: bootstrap starts it regardless of settings, for the life of the
// page (stop() exists for tests, and undoes everything).
import { EXTENSION_OWNED_ATTR, ns } from '../../../config/namespace';
import { HEADER } from '../../../config/selectors';
import { TIMINGS } from '../../../config/timings';
import { settingsModal } from './modal';
import { pageObserver } from '../../core/observer';
import { PRIMARY_BUTTON_STYLE } from '../../ui/styles';
import { isFromExtension, isOpenSettings } from '../../../shared/messages';
import { createLogger } from '../../../shared/logger';

const log = createLogger('settings-ui');

const SETTINGS_BUTTON_ID = ns('SettingsButton');

/** The inline layout of the page title before the button was added to it. */
type TitleStyle = Pick<CSSStyleDeclaration, 'display' | 'alignItems'>;

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

/** Always on for the life of the page: the way back to turning features on. */
export class SettingsLauncher {
  private started = false;
  private firstTry: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Page titles made flex to hold the button, with their layout before. */
  private readonly styled = new Map<HTMLElement, TitleStyle>();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.firstTry = setTimeout(this.inject, TIMINGS.settingsButtonFirstTry);
    // The AD app re-renders its header; put the button back when it goes.
    this.unsubscribe = pageObserver.subscribe(() => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(this.inject, TIMINGS.settingsButtonDebounce);
    });

    document.addEventListener('keydown', this.onKeydown, true);
    chrome.runtime?.onMessage?.addListener(this.onMessage);
  }

  /** Undo start(): listeners, timers, the button and the title layout. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.firstTry) clearTimeout(this.firstTry);
    if (this.debounce) clearTimeout(this.debounce);
    this.firstTry = null;
    this.debounce = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.removeEventListener('keydown', this.onKeydown, true);
    chrome.runtime?.onMessage?.removeListener(this.onMessage);
    document.getElementById(SETTINGS_BUTTON_ID)?.remove();
    for (const [title, previous] of this.styled) Object.assign(title.style, previous);
    this.styled.clear();
    // Closed and removed; the next open() (from the large editor's ⚙) rebuilds it.
    settingsModal.dispose();
  }

  private readonly open = (): void => settingsModal.open();

  /** Put the button next to the page title, unless it is there already. */
  private readonly inject = (): boolean => {
    if (document.getElementById(SETTINGS_BUTTON_ID)) return true;

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
      if (!this.styled.has(pageTitle)) {
        const { display, alignItems } = pageTitle.style;
        this.styled.set(pageTitle, { display, alignItems });
      }
      Object.assign(pageTitle.style, { display: 'flex', alignItems: 'center' });
    }

    pageTitle.appendChild(createSettingsButton(this.open));
    return true;
  };

  // Ctrl+, is the conventional chord, but Firefox and Zen bind it to their own
  // preferences and consume it before the page sees a keydown — so Alt+, is
  // accepted as an equivalent that no browser claims. The browser-level
  // command (Alt+Shift+S by default, and remappable) covers it either way;
  // see src/background/commands.ts.
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
  private readonly onMessage = (message: unknown, sender: chrome.runtime.MessageSender): void => {
    if (isFromExtension(sender) && isOpenSettings(message)) this.open();
  };
}
