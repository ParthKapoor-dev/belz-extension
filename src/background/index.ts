// Background service worker (Chromium) / background script (Firefox).
//
// Entry only: constructs and starts the three parts, each in its own module.
//
//   1. ContentScriptSync (content-scripts.ts): keeps the registered content
//      scripts in step with the user's site list.
//   2. MessageRelay (relay.ts): the PD Inspector relay and the "Open in
//      draft" autofill handoff, for validated senders only.
//   3. CommandHandler (commands.ts): the browser-level keyboard shortcuts.

import { ContentScriptSync } from './content-scripts';
import { MessageRelay } from './relay';
import { CommandHandler } from './commands';

new ContentScriptSync().start();
new MessageRelay().start();
new CommandHandler().start();
