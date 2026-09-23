// Automation Designer content script — loaded only on /automation-designer/*.

import { TitleUpdater } from './features/title-updater/index';
import { KeyboardShortcuts } from './features/keyboard/shortcuts';
import { copyAdRichLink } from './features/keyboard/ad-link';
import { runTestAction } from './features/run-test/index';
import { JsonEditor } from './features/json-editor/index';
import { jsonEditorModal } from './features/json-editor/modal';
import { startCurlAutofillFeature } from './features/curl-autofill/index';
import { OutputCopy } from './features/output-copy/index';
import { Ide } from './features/ide/index';
import { scanScope } from './features/ad-scope/scan';
import { settings } from './core/settings';
import { bootstrap } from './core/bootstrap';

bootstrap({
  titleUpdater: new TitleUpdater(),
  runTestShortcut: new KeyboardShortcuts({
    runTest: runTestAction,
    copyLink: () => void copyAdRichLink(),
    // Shift+J follows the JSON Editor setting, like the button does.
    openJsonEditor: () => {
      if (!settings.get().jsonEditor) return false;
      jsonEditorModal.open();
      return true;
    }
  }),
  jsonEditor: new JsonEditor(),
  outputCopy: new OutputCopy(),
  // The `#{variables}` in scope, re-read off the live method page on every IDE open.
  ide: new Ide((textarea) => scanScope(document, textarea))
});

// Fill the inputs from the AD Network panel's "Open in draft" handoff.
void startCurlAutofillFeature();
