import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { contentScriptSender, fakeChrome } from '../../fakes/chrome';
import { renderInputs } from '../../fixtures/ad-inputs';
import { withAutofill } from '../../../src/devtools/ad-network/network-panel';
import { startCurlAutofillFeature } from '../../../src/designer/features/curl-autofill/index';
import { MessageRelay } from '../../../src/background/relay';
import { writeHosts } from '../../../src/shared/hosts';
import { AUTOFILL_FRAGMENT_PARAM } from '../../../src/config/namespace';
import { AUTOFILL_HANDOFF_KEY_PREFIX } from '../../../src/config/storage-keys';
import type { HarEntry } from '../../../src/devtools/ad-network/types';
import { sleep, waitFor } from '../../wait';

// "Open in draft" end to end: the AD Network panel stores the request body and
// opens a URL carrying only a one-time id; the designer page takes the body
// through the background relay and fills its inputs. The three worlds run in
// one test here, joined by the fake chrome.

const START_URL = location.href;
const DESIGNER = 'https://designer.test/automation-designer/Cat/abc';
const relay = new MessageRelay();

/** The request the panel captured, with `body` as its payload. */
const captured = (body: string) => ({ request: { postData: { text: body } } }) as unknown as HarEntry;

/** Load `url` in "the tab": the content script sees it as location. */
function visit(url: string) {
  const { pathname, search, hash } = new URL(url);
  history.replaceState(null, '', pathname + search + hash);
}

beforeEach(async () => {
  fakeChrome.reset();
  await writeHosts([{ host: 'designer.test', enabled: true }]);
  // The content script's messages reach the background relay, as from this tab.
  fakeChrome.runtime.respond = (message) =>
    new Promise((resolve) => {
      if (!relay.onMessage(message, contentScriptSender(location.href) as chrome.runtime.MessageSender, resolve)) {
        resolve(undefined);
      }
    });
  document.body.innerHTML = '';
});
afterEach(() => history.replaceState(null, '', START_URL));

describe('Open in draft', () => {
  test('fills the inputs with a non-Latin-1 body, and keeps the rest of the URL', async () => {
    const body = JSON.stringify({ name: 'Zoë ✓ 日本' });
    const url = await withAutofill(`${DESIGNER}?tab=2#section`, captured(body));
    expect(url.includes('Zo')).toBe(false); // the body is not in the URL
    // The page's own query and a fragment of its own survive the marker.
    visit(url.replace('#', '#keep=1&'));
    renderInputs([{ key: 'name', type: 'Text' }]);

    await startCurlAutofillFeature();
    expect(location.search).toBe('?tab=2');
    expect(location.hash).toBe('#keep=1');
    expect([...fakeChrome.storage.session.data.keys()].some((k) => k.startsWith(AUTOFILL_HANDOFF_KEY_PREFIX))).toBe(false);

    document.title = 'AD: getUser'; // the app renders the method
    const field = document.querySelector('textarea')!;
    await waitFor(() => field.value === 'Zoë ✓ 日本', 'the input to be filled');
  });

  test('a link without a stored body (copied, reused, forged) fills nothing', async () => {
    visit(`${DESIGNER}#${AUTOFILL_FRAGMENT_PARAM}=${'0'.repeat(32)}`);
    renderInputs([{ key: 'name', type: 'Text', value: 'mine' }]);
    await startCurlAutofillFeature();
    expect(location.hash).toBe('');
    document.title = 'AD: getUser';
    await sleep(1200); // past the input poll and settle delays: nothing may be written
    expect(document.querySelector('textarea')!.value).toBe('mine');
  });

  test('a handoff is used once', async () => {
    const url = await withAutofill(DESIGNER, captured('{"name":"x"}'));
    const id = url.split('=').pop()!;
    visit(url);
    await startCurlAutofillFeature();
    expect(fakeChrome.storage.session.data.has(AUTOFILL_HANDOFF_KEY_PREFIX + id)).toBe(false);
    visit(url); // opened again
    fakeChrome.runtime.sent.length = 0;
    await startCurlAutofillFeature();
    const answers = await Promise.all(fakeChrome.runtime.sent.map((m) => fakeChrome.runtime.respond(m)));
    expect(answers).toEqual([null]);
  });

  test('a page that is not an allowed site gets nothing', async () => {
    await writeHosts([]);
    const url = await withAutofill(DESIGNER, captured('{"name":"x"}'));
    visit(url);
    fakeChrome.runtime.sent.length = 0;
    await startCurlAutofillFeature();
    expect(fakeChrome.runtime.sent.length).toBe(1); // it asked…
    expect([...fakeChrome.storage.session.data.keys()].some((k) => k.startsWith(AUTOFILL_HANDOFF_KEY_PREFIX))).toBe(true); // …and got nothing
  });
});
