// Preloaded before every test file (see bunfig.toml).
//
// Gives the tests a browser-like global environment: a DOM from happy-dom and
// an in-memory `chrome` API. Both must exist before any source module is
// imported, because several modules touch them at import time.
//
// Also starts the memory guard: a failing assertion on a value that holds DOM
// nodes makes bun's failure printer walk the entire DOM and eat memory without
// limit. The guard kills the run at a fixed cap instead. See
// tests/memory-guard-worker.ts.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { fakeChrome } from './fakes/chrome';

const guard = new Worker(new URL('./memory-guard-worker.ts', import.meta.url).href);
guard.unref();

GlobalRegistrator.register({ url: 'https://designer.test/automation-designer/Cat/abc' });
(globalThis as any).chrome = fakeChrome;
