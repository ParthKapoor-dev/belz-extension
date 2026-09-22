// Automation Designer content script — loaded only on /automation-designer/*.

import { startTitleUpdaterFeature } from './features/title-updater/index';
import { startRunTestShortcutFeature } from './features/keyboard/shortcuts';
import { startJSONFeature } from './features/json-editor/index';
import { startOutputCopyFeature } from './features/output-copy/index';
import { startTextareaEditorFeature } from './features/textarea-editor/index';
import { bootstrap } from './core/bootstrap';

bootstrap(
  {
    titleUpdater: startTitleUpdaterFeature,
    runTestShortcut: startRunTestShortcutFeature,
    jsonEditor: startJSONFeature,
    outputCopy: startOutputCopyFeature,
    textareaEditor: startTextareaEditorFeature
  },
  { curlAutofill: true }
);
