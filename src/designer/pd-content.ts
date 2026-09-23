// Page Designer content script — loaded only on /ui-designer/*.
//
// PD pages get the route-agnostic features only; AD-only features (JSON editor,
// curl autofill, Run Test, the method link) are not even bundled here. Of the
// keyboard shortcuts, PD has Esc Esc: Page Designer has no Run Test button, so
// Ctrl+Shift+Enter is left to the page.

import { TitleUpdater } from './features/title-updater/index';
import { KeyboardShortcuts } from './features/keyboard/shortcuts';
import { OutputCopy } from './features/output-copy/index';
import { Ide } from './features/ide/index';
import { bootstrap } from './core/bootstrap';

bootstrap({
  titleUpdater: new TitleUpdater(),
  runTestShortcut: new KeyboardShortcuts(),
  outputCopy: new OutputCopy(),
  ide: new Ide()
});
