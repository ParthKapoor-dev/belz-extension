import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fakeChrome } from '../fakes/chrome';
import { PanelRegistrar } from '../../src/devtools/panel-registrar';
import { writeHosts } from '../../src/shared/hosts';
import { waitFor } from '../wait';

// PanelRegistrar adds the two panels only when DevTools inspects an allowed,
// granted site. The inspected page is simulated through evalHandler.

const flush = () => new Promise((r) => setTimeout(r, 0));
const created = () => fakeChrome.devtools.panels.created.map(([title]) => title);

/** Make the inspected page answer `location.hostname` with `hostname`. */
function inspect(hostname: string | null) {
  fakeChrome.devtools.inspectedWindow.evalHandler = (expr) => (expr === 'location.hostname' ? hostname : null);
}

let registrar: PanelRegistrar;
beforeEach(() => {
  fakeChrome.reset();
  registrar = new PanelRegistrar();
});
afterEach(() => registrar.stop());

describe('PanelRegistrar', () => {
  test('creates both panels on a granted site', async () => {
    await writeHosts([{ host: 'site.test', enabled: true }]);
    inspect('site.test');
    registrar.start();
    await flush();
    expect(created()).toEqual(['AD Network', 'PD Inspector']);
    expect(fakeChrome.devtools.panels.created.map(([, page]) => page)).toEqual(['panel.html', 'panel-pd.html']);
  });

  test('matches a stored host regardless of case', async () => {
    await writeHosts([{ host: 'site.test', enabled: true }]);
    inspect('SITE.Test');
    registrar.start();
    await flush();
    expect(created().length).toBe(2);
  });

  test('asks for the hostname, so a page on a non-default port still matches', async () => {
    await writeHosts([{ host: 'site.test', enabled: true }]);
    // What the page would answer: hostname has no port, host has one.
    fakeChrome.devtools.inspectedWindow.evalHandler = (expr) =>
      expr === 'location.hostname' ? 'site.test' : expr === 'location.host' ? 'site.test:8443' : null;
    registrar.start();
    await flush();
    expect(created().length).toBe(2);
  });

  test('creates nothing on a site that is not listed, or listed but not granted', async () => {
    await writeHosts([{ host: 'seeded.test', enabled: false, seeded: true }]);
    inspect('other.test');
    registrar.start();
    await flush();
    inspect('seeded.test');
    fakeChrome.devtools.network.onNavigated.dispatch('https://seeded.test/');
    await flush();
    expect(created()).toEqual([]);
  });

  test('creates nothing when DevTools cannot read the host', async () => {
    await writeHosts([{ host: 'site.test', enabled: true }]);
    inspect(null);
    registrar.start();
    await flush();
    expect(created()).toEqual([]);
  });

  test('creates the panels after navigating to an allowed site, once', async () => {
    await writeHosts([{ host: 'site.test', enabled: true }]);
    inspect('other.test');
    registrar.start();
    await flush();
    expect(created()).toEqual([]);

    inspect('site.test');
    fakeChrome.devtools.network.onNavigated.dispatch('https://site.test/');
    await flush();
    fakeChrome.devtools.network.onNavigated.dispatch('https://site.test/again');
    await flush();
    expect(created()).toEqual(['AD Network', 'PD Inspector']);
  });

  test('creates the panels when the inspected host is added to the list', async () => {
    inspect('site.test');
    registrar.start();
    await flush();
    expect(created()).toEqual([]);
    await writeHosts([{ host: 'site.test', enabled: true }]);
    await waitFor(() => created().length === 2, 'both panels');
  });

  test('start() twice adds one set of listeners; stop() removes them and stops creating', async () => {
    const before = [
      fakeChrome.devtools.network.onNavigated.listeners.length,
      fakeChrome.storage.onChanged.listeners.length
    ];
    inspect('site.test');
    registrar.start();
    registrar.start();
    expect(fakeChrome.devtools.network.onNavigated.listeners.length).toBe(before[0]! + 1);
    expect(fakeChrome.storage.onChanged.listeners.length).toBe(before[1]! + 1);
    registrar.stop();
    registrar.stop();
    expect(fakeChrome.devtools.network.onNavigated.listeners.length).toBe(before[0]!);
    expect(fakeChrome.storage.onChanged.listeners.length).toBe(before[1]!);

    await writeHosts([{ host: 'site.test', enabled: true }]);
    await flush();
    expect(created()).toEqual([]);
  });

  test('a panel that fails to register is retried on the next navigation', async () => {
    await writeHosts([{ host: 'site.test', enabled: true }]);
    inspect('site.test');
    const realCreate = fakeChrome.devtools.panels.create;
    fakeChrome.devtools.panels.create = (title, icon, page, cb) => {
      fakeChrome.runtime.lastError = { message: 'nope' };
      realCreate(title, icon, page, cb);
      fakeChrome.runtime.lastError = undefined;
    };
    try {
      registrar.start();
      await flush();
    } finally {
      fakeChrome.devtools.panels.create = realCreate;
    }
    fakeChrome.devtools.panels.created.length = 0;
    fakeChrome.devtools.network.onNavigated.dispatch('https://site.test/');
    await flush();
    expect(created()).toEqual(['AD Network', 'PD Inspector']);
  });
});
