// Every message that crosses between the extension's worlds, in one place.
//
// The worlds cannot share memory, only messages (chrome.runtime / chrome.tabs)
// and storage. Declaring the shapes here means a sender and its receiver are
// checked against the same definition, so renaming a field breaks the build
// instead of silently breaking the feature.
//
// Types only: nothing here exists at runtime except the small guards.

// ---- PD Inspector: panel <-> page engine -----------------------------------

/** A command from the PD Inspector panel to the page engine. */
export type PdCommand =
  | { ns: 'pd'; cmd: 'getState' }
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
 * chrome.tabs: `cmd` forwards a command to the inspected tab, `open` opens a
 * URL in a new tab.
 */
export type PdRelayMessage =
  | { __pdRelay: 'cmd'; tabId: number; payload: PdCommand }
  | { __pdRelay: 'open'; url: string };

export function isPdCommand(msg: unknown): msg is PdCommand {
  const m = msg as Partial<PdCommand> | null;
  return Boolean(m) && m!.ns === 'pd' && typeof (m as { cmd?: unknown }).cmd === 'string';
}

export function isPdPick(msg: unknown): msg is PdPickMessage {
  const m = msg as Partial<PdPickMessage> | null;
  return Boolean(m) && m!.ns === 'pd' && m!.type === 'pick' && Array.isArray(m!.chain);
}

export function isPdRouteChanged(msg: unknown): msg is PdRouteChangedMessage {
  const m = msg as Partial<PdRouteChangedMessage> | null;
  return Boolean(m) && m!.ns === 'pd' && m!.type === 'routeChanged';
}

export function isPdRelay(msg: unknown): msg is PdRelayMessage {
  return Boolean(msg) && typeof (msg as { __pdRelay?: unknown }).__pdRelay === 'string';
}

// ---- browser commands ----------------------------------------------------------

/** Background -> designer content script: open the settings modal. */
export interface OpenSettingsMessage {
  __sdxCommand: 'open-settings';
}

export function isOpenSettings(msg: unknown): msg is OpenSettingsMessage {
  return Boolean(msg) && (msg as OpenSettingsMessage).__sdxCommand === 'open-settings';
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
