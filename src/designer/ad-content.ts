// Automation Designer content script — loaded only on /automation-designer/*.

import { TitleUpdater } from './features/title-updater/index';
import { KeyboardShortcuts } from './features/keyboard/shortcuts';
import { JsonEditor } from './features/json-editor/index';
import { jsonEditorModal } from './features/json-editor/modal';
import { startCurlAutofillFeature } from './features/curl-autofill/index';
import { OutputCopy } from './features/output-copy/index';
import { TextareaEditor } from './features/textarea-editor/index';
import { bootstrap } from './core/bootstrap';

bootstrap({
  titleUpdater: new TitleUpdater(),
  runTestShortcut: new KeyboardShortcuts(() => jsonEditorModal.open()),
  jsonEditor: new JsonEditor(),
  outputCopy: new OutputCopy(),
  textareaEditor: new TextareaEditor()
});

// Fill the inputs from the AD Network panel's "open with this request" link.
startCurlAutofillFeature();
