// The background's message handler: the only messages it answers.
//
//   - PD Inspector relay (`PdRelayMessage`). Firefox gives DevTools panels no
//     chrome.tabs, so the PD Inspector panel asks the background to forward
//     its commands to the inspected tab, and to open Page Designer links.
//     Accepted only from this extension's own pages (never a content
//     script), with a well-formed command. `open` opens only an https URL on
//     a granted site.
//   - "Open in draft" autofill (`TakeAutofillMessage`). A designer page asks
//     for the request body the AD Network panel left for it. Answered only
//     for this extension's content script on an Automation Designer page of a
//     granted https site; the body is read once (shared/autofill-handoff.ts).
//     Takes run one at a time, so two requests for one id cannot both read
//     the body before either has removed it.
//
// Anything else, or from anyone else, is ignored.

import { AD_ROUTE_PREFIX } from '../config/routes';
import { takeHandoff } from '../shared/autofill-handoff';
import { enabledHostSet, isAllowedUrl } from '../shared/hosts';
import { createLogger } from '../shared/logger';
import {
  isFromExtension,
  isFromExtensionPage,
  isPdRelay,
  isTakeAutofill,
  type PdRelayMessage,
  type TakeAutofillMessage
} from '../shared/messages';

const log = createLogger('background');

type Sender = chrome.runtime.MessageSender;
type Respond = (response: unknown) => void;

/** True when `url` is https on a granted site, as stored now. */
async function isOnAllowedSite(url: string | undefined): Promise<boolean> {
  return isAllowedUrl(url, await enabledHostSet());
}

export class MessageRelay {
  private started = false;
  /** The handoff take running now (or the last one); the next waits for it. */
  private taking: Promise<unknown> = Promise.resolve();

  start(): void {
    if (this.started) return;
    this.started = true;
    chrome.runtime.onMessage.addListener(this.onMessage);
  }

  stop(): void {
    this.started = false;
    chrome.runtime.onMessage.removeListener(this.onMessage);
  }

  /** Returns true when it will answer (asynchronously), as onMessage expects. */
  readonly onMessage = (msg: unknown, sender: Sender, sendResponse: Respond): boolean => {
    if (isPdRelay(msg)) {
      if (!isFromExtensionPage(sender)) return false;
      this.relay(msg, sendResponse);
      return true;
    }
    if (isTakeAutofill(msg)) {
      void this.takeAutofill(msg, sender).then(sendResponse, (err: unknown) => {
        log.warn('cannot hand the autofill body over:', err);
        sendResponse(null);
      });
      return true;
    }
    return false;
  };

  private relay(msg: PdRelayMessage, sendResponse: Respond): void {
    if (msg.__pdRelay === 'cmd') {
      try {
        chrome.tabs.sendMessage(msg.tabId, msg.payload, (resp: unknown) => {
          sendResponse(chrome.runtime.lastError ? null : resp);
        });
      } catch (err) {
        log.warn('cannot relay to the PD Inspector engine:', err);
        sendResponse(null);
      }
      return;
    }
    void this.open(msg.url).then((ok) => sendResponse({ ok }));
  }

  private async open(url: string): Promise<boolean> {
    try {
      if (!(await isOnAllowedSite(url))) {
        log.warn('refusing to open a URL that is not on an allowed site:', url);
        return false;
      }
      await chrome.tabs.create({ url });
      return true;
    } catch (err) {
      log.warn('cannot open a tab:', err);
      return false;
    }
  }

  private async takeAutofill(msg: TakeAutofillMessage, sender: Sender): Promise<string | null> {
    if (!isFromExtension(sender) || !sender.tab || !sender.url) return null;
    let path = '';
    try {
      path = new URL(sender.url).pathname;
    } catch {
      return null;
    }
    if (!path.startsWith(AD_ROUTE_PREFIX) || !(await isOnAllowedSite(sender.url))) return null;
    // One take at a time: takeHandoff reads, then removes.
    const take = this.taking.then(() => takeHandoff(msg.id));
    this.taking = take.catch(() => null);
    return take;
  }
}
