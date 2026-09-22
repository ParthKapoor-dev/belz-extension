// The contract every designer feature follows.
//
// bootstrap() starts a feature when its setting turns on and stops it when
// the setting turns off, possibly many times on one page. So:
//   - start() and stop() must each be safe to call twice in a row;
//   - stop() must undo everything start() did: listeners, timers, observer
//     subscriptions and any DOM the feature added.

export interface Feature {
  start(): void;
  stop(): void;
}
