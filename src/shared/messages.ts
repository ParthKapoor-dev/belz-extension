// Every message that crosses between the extension's worlds, in one place.
//
// The worlds cannot share memory, only messages (chrome.runtime / chrome.tabs)
// and storage. Declaring the shapes here means a sender and its receiver are
// checked against the same definition, so renaming a field breaks the build
// instead of silently breaking the feature.
//
// The guards check the whole shape, not just a tag: a receiver acts only on a
// message that is exactly what it expects. Who may send it (the sender check)
// is up to the receiver; see isFromExtension() and isFromExtensionPage().
//
// Types only: nothing here exists at runtime except the small guards.

import { AUTOFILL_MESSAGE_KEY, COMMAND_MESSAGE_KEY, HOSTS_MESSAGE_KEY } from '../config/namespace';
import { OPTIONS_PAGE } from '../config/extension-files';

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json | null =>
  value !== null && typeof value === 'object' ? (value as Json) : null;

// ---- senders ------------------------------------------------------------------

/** Sent by this extension (any of its pages or content scripts), not another one. */
export function isFromExtension(sender: chrome.runtime.MessageSender | null | undefined): boolean {
  return Boolean(sender) && sender!.id === chrome.runtime.id;
}

/**
 * Sent by one of this extension's own pages (a DevTools panel, the options
 * page): no `sender.tab` (a content script always has one), and a URL on the
 * extension's own origin.
 */
export function isFromExtensionPage(sender: chrome.runtime.MessageSender | null | undefined): boolean {
  if (!isFromExtension(sender) || sender!.tab) return false;
  const url = sender!.url;
  return typeof url === 'string' && url.startsWith(chrome.runtime.getURL(''));
}

/** Sent by this extension's options page: an extension page at OPTIONS_PAGE. */
export function isFromOptionsPage(sender: chrome.runtime.MessageSender | null | undefined): boolean {
  return isFromExtensionPage(sender) && sender!.url!.split(/[?#]/)[0] === chrome.runtime.getURL(OPTIONS_PAGE);
}

// ---- PD Inspector: panel <-> page engine -----------------------------------

/** A command from the PD Inspector panel to the page engine. */
export type PdCommand =
  | { ns: 'pd'; cmd: 'getState' }
  /** Also the panel's heartbeat: re-sent with `on: true` while inspecting. */
  | { ns: 'pd'; cmd: 'setInspect'; on: boolean }
  | { ns: 'pd'; cmd: 'highlightComponent'; name: string }
  | { ns: 'pd'; cmd: 'clearHighlight' };

/** Pushed by the engine when the user clicks an element in inspect mode. */
export interface PdPickMessage {
  ns: 'pd';
  type: 'pick';
  /** Owning component chain, outermost first. */
  chain: string[];
  nodeName: string;
}

/**
 * Pushed by the engine when the published page's route changed: it has left
 * inspect mode and is rebuilding, so the panel reloads.
 */
export interface PdRouteChangedMessage {
  ns: 'pd';
  type: 'routeChanged';
}

/** Everything the engine pushes to the panel. */
export type PdPushMessage = PdPickMessage | PdRouteChangedMessage;

/**
 * Sent to the background relay, because Firefox gives DevTools panels no
 * chrome.tabs: `cmd` forwards a command to the inspected tab, `open` opens an
 * https URL on an allowed site in a new tab.
 */
export type PdRelayMessage =
  | { __pdRelay: 'cmd'; tabId: number; payload: PdCommand }
  | { __pdRelay: 'open'; url: string };

export function isPdCommand(msg: unknown): msg is PdCommand {
  const m = asRecord(msg);
  if (!m || m.ns !== 'pd') return false;
  switch (m.cmd) {
    case 'getState':
    case 'clearHighlight':
      return true;
    case 'setInspect':
      return typeof m.on === 'boolean';
    case 'highlightComponent':
      return typeof m.name === 'string';
    default:
      return false;
  }
}

export function isPdPick(msg: unknown): msg is PdPickMessage {
  const m = asRecord(msg);
  return (
    Boolean(m) && m!.ns === 'pd' && m!.type === 'pick' &&
    Array.isArray(m!.chain) && (m!.chain as unknown[]).every((c) => typeof c === 'string')
  );
}

export function isPdRouteChanged(msg: unknown): msg is PdRouteChangedMessage {
  const m = asRecord(msg);
  return Boolean(m) && m!.ns === 'pd' && m!.type === 'routeChanged';
}

export function isPdRelay(msg: unknown): msg is PdRelayMessage {
  const m = asRecord(msg);
  if (!m) return false;
  if (m.__pdRelay === 'cmd') return Number.isInteger(m.tabId) && isPdCommand(m.payload);
  if (m.__pdRelay === 'open') return typeof m.url === 'string';
  return false;
}

// ---- browser commands ----------------------------------------------------------

/** Background -> designer content script: open the in-page Settings modal. */
export interface OpenSettingsMessage {
  [COMMAND_MESSAGE_KEY]: 'open-settings';
}

export function isOpenSettings(msg: unknown): msg is OpenSettingsMessage {
  return asRecord(msg)?.[COMMAND_MESSAGE_KEY] === 'open-settings';
}

/**
 * The focus-hint flag the background writes to storage for a keyboard
 * shortcut, which the targeted DevTools panel reacts to.
 */
export interface FocusFlag {
  target: 'ad' | 'pd';
  /** When the shortcut fired (epoch ms); stale flags are ignored. */
  ts: number;
}

// ---- the allowed-sites list ------------------------------------------------------

/**
 * Options page -> background: one change to the allowed-sites list, which
 * only the background writes. `add` follows a permission the browser granted:
 * it lists the host, or marks a listed one granted. `revoke` follows a
 * permission the browser removed: it drops the entry. `designerHost` sets a
 * listed host's designer host, or clears it with ''. Answered with a
 * HostsEditResult once the list is stored.
 */
export type HostsEdit =
  | { [HOSTS_MESSAGE_KEY]: 'add'; host: string }
  | { [HOSTS_MESSAGE_KEY]: 'revoke'; host: string }
  | { [HOSTS_MESSAGE_KEY]: 'designerHost'; host: string; designerHost: string };

/** The background's answer to a HostsEdit: why it was refused, when it was. */
export type HostsEditResult = { ok: true } | { ok: false; error: string };

export function isHostsEdit(msg: unknown): msg is HostsEdit {
  const m = asRecord(msg);
  if (!m || typeof m.host !== 'string') return false;
  switch (m[HOSTS_MESSAGE_KEY]) {
    case 'add':
    case 'revoke':
      return true;
    case 'designerHost':
      return typeof m.designerHost === 'string';
    default:
      return false;
  }
}

// ---- "Open in draft" autofill ----------------------------------------------------

/**
 * Designer content script -> background: hand over (and forget) the request
 * body stored for this handoff id. Answered with the body, or null.
 */
export interface TakeAutofillMessage {
  [AUTOFILL_MESSAGE_KEY]: 'take';
  id: string;
}

export function isTakeAutofill(msg: unknown): msg is TakeAutofillMessage {
  const m = asRecord(msg);
  return Boolean(m) && m![AUTOFILL_MESSAGE_KEY] === 'take' && typeof m!.id === 'string';
}
