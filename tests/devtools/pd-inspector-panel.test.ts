import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeChrome } from '../fakes/chrome';
import { PdInspectorPanel } from '../../src/devtools/pd-inspector/inspector-panel';
import { writeFocusFlag } from '../../src/shared/focus-flag';
import { TIMINGS } from '../../src/config/timings';
import type { PdCommand, PdRelayMessage } from '../../src/shared/messages';
import type { EngineState, SerializedComponentNode } from '../../src/pd-inspector-page/types';

// Drives the real PD Inspector panel over its real markup (panel.html). The
// page-side engine is faked behind chrome.runtime.sendMessage, which is how
// the panel reaches it (through the background relay). Assertions read text,
// class names and plain values only (see tests/memory-guard-worker.ts).

const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const text = (sel: string) => $(sel)?.textContent ?? '';
const compNames = () => [...document.querySelectorAll('#body .comp .cname')].map((e) => e.textContent);

const summary = { total: 2, bound: 1, hidden: 0 };
const leaf = (name: string): SerializedComponentNode => ({
  name, kind: 'component', isPage: false, referencePageId: '', nodeSummary: summary, error: null, children: [],
  nodeTree: {
    id: 'n1', name: 'div', kind: 'LAYOUT', label: 'div', fieldName: '', depth: 0,
    visibility: { kind: 'always' },
    children: [{
      id: 'n2', name: 'button', kind: 'BUTTON', label: 'Save', fieldName: '', depth: 1,
      visibility: { kind: 'bound', expr: 'ctx.canSave' }, children: []
    }]
  }
});
const READY: EngineState = {
  status: 'ready',
  pageInfo: {
    host: 'site.test', path: 'app/home', env: 'site', referencePageId: 'page-1', pageVersionId: 3,
    shellPath: '', shellReferencePageId: '', componentCount: 2, configNodes: 10,
    anchors: { anchored: 4, exact: 3, positional: 1, unresolved: 6 }
  },
  componentTree: {
    name: 'app/home', kind: 'page', isPage: true, referencePageId: 'page-1', nodeTree: null,
    nodeSummary: summary, error: null, children: [leaf('Header'), leaf('Footer')]
  }
};

/** What the fake engine answers to getState, and every command it received. */
let engineState: EngineState | undefined;
let commands: PdCommand[] = [];

function installEngine() {
  commands = [];
  fakeChrome.runtime.respond = (message) => {
    const m = message as PdRelayMessage;
    if (m.__pdRelay !== 'cmd') return undefined;
    commands.push(m.payload);
    if (m.payload.cmd === 'getState') return engineState;
    return { ok: true };
  };
}

let panel: PdInspectorPanel;
let baseline: number[] = [];
const listenerCounts = () => [
  fakeChrome.runtime.onMessage.listeners.length,
  fakeChrome.devtools.network.onNavigated.listeners.length,
  fakeChrome.storage.onChanged.listeners.length
];

beforeAll(async () => {
  const html = readFileSync(join(import.meta.dir, '../../src/devtools/pd-inspector/panel.html'), 'utf8');
  document.body.innerHTML = html
    .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    .replace(/<script[^>]*><\/script>/g, '');
  fakeChrome.reset();
  engineState = READY;
  installEngine();
  panel = new PdInspectorPanel();
  baseline = listenerCounts();
  panel.start();
  await flush();
});
afterAll(() => panel.stop());
beforeEach(() => installEngine());

describe('PdInspectorPanel', () => {
  test('renders the page info and the component tree from the engine', () => {
    expect(text('#body .info')).toContain('app/home');
    expect(text('#body .info')).toContain('4 of 10 nodes  (3 exact, 1 positional)');
    expect(compNames()).toEqual(['app/home', 'Header', 'Footer']);
    expect($<HTMLButtonElement>('#inspect').disabled).toBe(false);
  });

  test('selecting a component shows its layout and highlights it on the page', async () => {
    const header = [...document.querySelectorAll<HTMLElement>('#body .comp')][1]!;
    header.click();
    await flush();
    expect(header.classList.contains('sel')).toBe(true);
    expect(text('#detail .detail-head .nm')).toBe('Header');
    expect([...document.querySelectorAll('#detail .nlabel')].map((e) => e.textContent)).toEqual(['div', 'Save']);
    expect(commands).toEqual([{ ns: 'pd', cmd: 'highlightComponent', name: 'Header' }]);
  });

  test('Inspect toggles inspect mode on the engine', async () => {
    $('#inspect').click();
    await flush();
    expect(text('#inspect')).toBe('Inspecting…');
    $('#inspect').click();
    await flush();
    expect(text('#inspect')).toBe('Inspect');
    expect(commands).toEqual([
      { ns: 'pd', cmd: 'setInspect', on: true },
      { ns: 'pd', cmd: 'setInspect', on: false }
    ]);
  });

  test('a pick from the inspected tab selects the component; other tabs are ignored', async () => {
    fakeChrome.runtime.onMessage.dispatch({ ns: 'pd', type: 'pick', chain: ['app/home', 'Footer'] }, { tab: { id: 99 } });
    expect(text('#picked-row .v')).toBe('');
    fakeChrome.runtime.onMessage.dispatch({ ns: 'pd', type: 'pick', chain: ['app/home', 'Footer'] }, { tab: { id: 1 } });
    await flush();
    expect(text('#picked-row .v')).toBe('app/home  ›  Footer');
    expect(text('#detail .detail-head .nm')).toBe('Footer');
  });

  test('no engine answer shows the notice and disables Inspect', async () => {
    engineState = undefined;
    $('#refresh').click();
    await flush();
    expect(text('#body .notice')).toContain('Open a published page');
    expect($<HTMLButtonElement>('#inspect').disabled).toBe(true);
  });

  test('an engine error is shown', async () => {
    engineState = { status: 'error', error: 'boom' };
    $('#refresh').click();
    await flush();
    expect(text('#body .notice')).toBe('Could not load the page config: boom');
  });

  test('a route change reloads and resets inspect mode', async () => {
    engineState = READY;
    $('#inspect').click();
    fakeChrome.runtime.onMessage.dispatch({ ns: 'pd', type: 'routeChanged' }, { tab: { id: 1 } });
    await flush();
    expect(text('#inspect')).toBe('Inspect');
    expect(compNames()).toEqual(['app/home', 'Header', 'Footer']);
  });

  test('the focus shortcut reloads and pulses the panel for TIMINGS.panelFocusFlash', async () => {
    engineState = READY;
    writeFocusFlag('pd');
    await flush();
    expect(document.body.classList.contains('focus-flash')).toBe(true);
    expect(document.body.style.getPropertyValue('--focus-flash-ms')).toBe(`${TIMINGS.panelFocusFlash}ms`);
    expect(commands.some((c) => c.cmd === 'getState')).toBe(true);
  });

  test('start() is idempotent and stop() removes every listener and the pulse', async () => {
    panel.start();
    expect(listenerCounts()).toEqual(baseline.map((n) => n + 1));
    panel.stop();
    panel.stop();
    expect(listenerCounts()).toEqual(baseline);
    expect(document.body.classList.contains('focus-flash')).toBe(false);
    expect(document.body.style.getPropertyValue('--focus-flash-ms')).toBe('');

    // Stopped: the buttons no longer reach the engine.
    $('#refresh').click();
    await flush();
    expect(commands.length).toBe(0);
    panel.start();
    await flush();
  });
});
