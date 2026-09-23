import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { contentScriptSender, extensionPageSender, fakeChrome } from '../fakes/chrome';
import { MessageRelay } from '../../src/background/relay';
import { CommandHandler } from '../../src/background/commands';
import { storeHandoff } from '../../src/shared/autofill-handoff';
import { writeHosts } from '../../src/shared/hosts';
import { AUTOFILL_MESSAGE_KEY, COMMAND_MESSAGE_KEY } from '../../src/config/namespace';
import { FOCUS_STORAGE_KEY } from '../../src/config/storage-keys';

// The background's message relay and browser-command handler: they act only
// on well-formed messages from this extension, and open only allowed sites.

const relay = new MessageRelay();
const commands = new CommandHandler();

/** Send `msg` from `sender`; resolves with the answer, or 'ignored' when the relay does not take it. */
function send(msg: unknown, sender: object): Promise<unknown> {
  return new Promise((resolve) => {
    const willAnswer = relay.onMessage(msg, sender as chrome.runtime.MessageSender, resolve);
    if (!willAnswer) resolve('ignored');
  });
}

const PD_COMMAND = { ns: 'pd', cmd: 'setInspect', on: true };
const AD_PAGE = 'https://site.test/automation-designer/Cat/abc';

beforeEach(async () => {
  fakeChrome.reset();
  await writeHosts([{ host: 'site.test', enabled: true }, { host: 'off.test', enabled: false }]);
  relay.start();
  commands.start();
});
afterEach(() => {
  relay.stop();
  commands.stop();
});

describe('PD Inspector relay', () => {
  test('forwards a well-formed command from the panel to the tab, and returns its answer', async () => {
    fakeChrome.tabs.respond = () => ({ ok: true, inspecting: true });
    const answer = await send({ __pdRelay: 'cmd', tabId: 7, payload: PD_COMMAND }, extensionPageSender);
    expect(answer).toEqual({ ok: true, inspecting: true });
    expect(fakeChrome.tabs.messages).toEqual([[7, PD_COMMAND]]);
  });

  test('ignores a command from a content script or another extension', async () => {
    const msg = { __pdRelay: 'cmd', tabId: 7, payload: PD_COMMAND };
    expect(await send(msg, contentScriptSender(AD_PAGE))).toBe('ignored');
    expect(await send(msg, { id: 'another-extension' })).toBe('ignored');
    expect(fakeChrome.tabs.messages).toEqual([]);
  });

  test('ignores a malformed command', async () => {
    for (const payload of [
      { ns: 'pd', cmd: 'setInspect', on: 'yes' },
      { ns: 'pd', cmd: 'highlightComponent' },
      { ns: 'pd', cmd: 'runScript', code: 'alert(1)' },
      null
    ]) {
      expect(await send({ __pdRelay: 'cmd', tabId: 7, payload }, extensionPageSender)).toBe('ignored');
    }
    expect(await send({ __pdRelay: 'cmd', tabId: '7', payload: PD_COMMAND }, extensionPageSender)).toBe('ignored');
    expect(fakeChrome.tabs.messages).toEqual([]);
  });

  test('opens an https page of an allowed site', async () => {
    const url = 'https://site.test/ui-designer/page/p1';
    expect(await send({ __pdRelay: 'open', url }, extensionPageSender)).toEqual({ ok: true });
    expect(fakeChrome.tabs.created).toEqual([{ url }]);
  });

  test('refuses to open anything else', async () => {
    for (const url of [
      'javascript:alert(1)',
      'http://site.test/ui-designer/',
      'https://evil.test/',
      'https://off.test/ui-designer/',
      'file:///etc/passwd'
    ]) {
      expect(await send({ __pdRelay: 'open', url }, extensionPageSender)).toEqual({ ok: false });
    }
    expect(await send({ __pdRelay: 'open', url: 'https://site.test/' }, contentScriptSender(AD_PAGE))).toBe('ignored');
    expect(fakeChrome.tabs.created).toEqual([]);
  });

  test('anything that is not a relay message is left to other listeners', async () => {
    expect(await send({ ns: 'pd', type: 'pick', chain: [] }, extensionPageSender)).toBe('ignored');
    expect(await send('hello', extensionPageSender)).toBe('ignored');
  });
});

describe('autofill handoff', () => {
  const take = (id: string) => ({ [AUTOFILL_MESSAGE_KEY]: 'take', id });

  test('hands the body to the AD page of an allowed site, once', async () => {
    const id = await storeHandoff('{"a":"Zoë"}');
    expect(await send(take(id), contentScriptSender(AD_PAGE))).toBe('{"a":"Zoë"}');
    expect(await send(take(id), contentScriptSender(AD_PAGE))).toBeNull();
  });

  test('answers nothing to a page of another site, a non-AD page, or a sender that is not our content script', async () => {
    const id = await storeHandoff('{"a":1}');
    expect(await send(take(id), contentScriptSender('https://evil.test/automation-designer/x'))).toBeNull();
    expect(await send(take(id), contentScriptSender('https://off.test/automation-designer/x'))).toBeNull();
    expect(await send(take(id), contentScriptSender('https://site.test/ui-designer/x'))).toBeNull();
    expect(await send(take(id), { id: 'another-extension', url: AD_PAGE, tab: { id: 1 } })).toBeNull();
    expect(await send(take(id), extensionPageSender)).toBeNull(); // no tab: not a page
    // Still there for the right page.
    expect(await send(take(id), contentScriptSender(AD_PAGE))).toBe('{"a":1}');
  });

  test('an unknown or malformed id finds nothing', async () => {
    expect(await send(take('0'.repeat(32)), contentScriptSender(AD_PAGE))).toBeNull();
    expect(await send(take('../../x'), contentScriptSender(AD_PAGE))).toBeNull();
  });
});

describe('browser commands', () => {
  test('open-settings asks the active tab to open the in-page Settings modal', () => {
    fakeChrome.tabs.queryResult = [{ id: 4 }];
    fakeChrome.commands.onCommand.dispatch('open-settings');
    expect(fakeChrome.tabs.messages).toEqual([[4, { [COMMAND_MESSAGE_KEY]: 'open-settings' }]]);
  });

  test('the focus shortcuts write the focus flag for their panel', async () => {
    fakeChrome.commands.onCommand.dispatch('focus-pd-inspector');
    await Promise.resolve();
    expect((fakeChrome.storage.session.data.get(FOCUS_STORAGE_KEY) as { target: string }).target).toBe('pd');
    fakeChrome.commands.onCommand.dispatch('focus-ad-network');
    await Promise.resolve();
    expect((fakeChrome.storage.session.data.get(FOCUS_STORAGE_KEY) as { target: string }).target).toBe('ad');
  });

  test('an unknown command does nothing', () => {
    fakeChrome.commands.onCommand.dispatch('something-else');
    expect(fakeChrome.tabs.messages).toEqual([]);
    expect(fakeChrome.storage.session.data.has(FOCUS_STORAGE_KEY)).toBe(false);
  });
});
