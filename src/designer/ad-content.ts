// Automation Designer content script — loaded only on /automation-designer/*.

import { TitleUpdater } from './features/title-updater/index';
import { KeyboardShortcuts } from './features/keyboard/shortcuts';
import { JsonEditor } from './features/json-editor/index';
import { OutputCopy } from './features/output-copy/index';
import { TextareaEditor } from './features/textarea-editor/index';
import { bootstrap } from './core/bootstrap';

bootstrap(
  {
    titleUpdater: new TitleUpdater(),
    runTestShortcut: new KeyboardShortcuts(),
    jsonEditor: new JsonEditor(),
    outputCopy: new OutputCopy(),
    textareaEditor: new TextareaEditor()
  },
  { curlAutofill: true }
);
