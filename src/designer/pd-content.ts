// Page Designer content script — loaded only on /ui-designer/*.
//
// PD pages get the route-agnostic features only; AD-only features (JSON editor,
// curl autofill) are not even bundled here.

import { TitleUpdater } from './features/title-updater/index';
import { KeyboardShortcuts } from './features/keyboard/shortcuts';
import { OutputCopy } from './features/output-copy/index';
import { TextareaEditor } from './features/textarea-editor/index';
import { bootstrap } from './core/bootstrap';

bootstrap(
  {
    titleUpdater: new TitleUpdater(),
    runTestShortcut: new KeyboardShortcuts(),
    outputCopy: new OutputCopy(),
    textareaEditor: new TextareaEditor()
  },
  { curlAutofill: false }
);
