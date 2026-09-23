// Automation Designer content script — loaded only on /automation-designer/*.

import { TitleUpdater } from './features/title-updater/index';
import { KeyboardShortcuts } from './features/keyboard/shortcuts';
import { JsonEditor } from './features/json-editor/index';
import { jsonEditorModal } from './features/json-editor/modal';
import { startCurlAutofillFeature } from './features/curl-autofill/index';
import { OutputCopy } from './features/output-copy/index';
import { TextareaEditor } from './features/textarea-editor/index';
import { scanScope } from './features/ad-scope/scan';
import { bootstrap } from './core/bootstrap';

bootstrap({
  titleUpdater: new TitleUpdater(),
  runTestShortcut: new KeyboardShortcuts(() => jsonEditorModal.open()),
  jsonEditor: new JsonEditor(),
  outputCopy: new OutputCopy(),
  // The `#{variables}` in scope, re-read off the live method page on every editor open.
  textareaEditor: new TextareaEditor((textarea) => scanScope(document, textarea))
});

// Fill the inputs from the AD Network panel's "open with this request" link.
startCurlAutofillFeature();
