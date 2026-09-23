// DevTools page entry (one per open DevTools window). The work is
// PanelRegistrar (panel-registrar.ts); this file only starts it.
import { PanelRegistrar } from './panel-registrar';

new PanelRegistrar().start();
