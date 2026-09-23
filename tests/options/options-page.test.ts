import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeChrome } from '../fakes/chrome';
import { OptionsPage } from '../../src/options/options-page';
import { originPattern, readHosts, writeHosts } from '../../src/shared/hosts';

// Drives the real OptionsPage over the real options.html markup, with the
// fake chrome.permissions and chrome.storage. Assertions read text, class
// names and plain values only (see tests/memory-guard-worker.ts).

const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const items = () => [...document.querySelectorAll<HTMLLIElement>('#host-list li')];
/** Each row as plain text: host (with its badge), and its button. */
const rows = () =>
  items().map((li) => ({
    host: li.querySelector('.host')!.firstChild!.textContent,
    granted: !li.querySelector('.needs-grant'),
    button: li.querySelector('button')!.textContent
  }));
const button = (host: string) =>
  items().find((li) => li.querySelector('.host')!.firstChild!.textContent === host)!.querySelector('button')!;
const errorText = () => $('#error').textContent;

async function submit(value: string) {
  $<HTMLInputElement>('#add-input').value = value;
  $<HTMLFormElement>('#add-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
}

let page: OptionsPage;
let baseline: number[] = [];
const listenerCounts = () => [
  fakeChrome.storage.onChanged.listeners.length,
  fakeChrome.permissions.onAdded.listeners.length,
  fakeChrome.permissions.onRemoved.listeners.length
];

beforeAll(() => {
  const html = readFileSync(join(import.meta.dir, '../../src/options/options.html'), 'utf8');
  document.body.innerHTML = html
    .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    .replace(/<script[^>]*><\/script>/g, '');
  fakeChrome.reset();
  page = new OptionsPage();
  baseline = listenerCounts();
  page.start();
});
afterAll(() => page.stop());
beforeEach(async () => {
  fakeChrome.reset();
  await writeHosts([]);
  await flush();
});

describe('OptionsPage', () => {
  test('an empty list shows the empty note', () => {
    expect(items().length).toBe(0);
    expect($('#empty').style.display).toBe('block');
  });

  test('Add asks for the permission, then stores and lists the host', async () => {
    await submit('  HTTPS://Site.Test:8443/some/path ');
    expect(fakeChrome.permissions.requested).toEqual([[originPattern('site.test')]]);
    expect((await readHosts()).map((h) => [h.host, h.enabled])).toEqual([['site.test', true]]);
    expect(rows()).toEqual([{ host: 'site.test', granted: true, button: 'Revoke' }]);
    expect($<HTMLInputElement>('#add-input').value).toBe('');
    expect($('#empty').style.display).toBe('none');
    expect(errorText()).toBe('');
  });

  test('an invalid hostname is refused without asking the browser', async () => {
    await submit('not a host!');
    expect(fakeChrome.permissions.requested.length).toBe(0);
    expect(errorText()).toContain('Enter a valid hostname');
    expect(errorText()).toContain('your-instance.example.com');
  });

  test('a denied permission stores nothing', async () => {
    fakeChrome.permissions.allowRequest = false;
    await submit('site.test');
    expect(errorText()).toBe('Permission for site.test was denied.');
    expect(await readHosts()).toEqual([]);
  });

  test('a seeded, ungranted entry shows Grant; granting it clears the seed flag', async () => {
    await writeHosts([{ host: 'seeded.test', enabled: false, seeded: true }]);
    await flush();
    expect(rows()).toEqual([{ host: 'seeded.test', granted: false, button: 'Grant' }]);

    button('seeded.test').click();
    await flush();
    expect(rows()).toEqual([{ host: 'seeded.test', granted: true, button: 'Revoke' }]);
    const [stored] = await readHosts();
    expect([stored!.enabled, stored!.seeded]).toEqual([true, undefined]);
  });

  test('the stored enabled flag follows the browser, not the other way round', async () => {
    // Stored as enabled, but the browser holds no grant (revoked elsewhere).
    await writeHosts([{ host: 'site.test', enabled: true }]);
    await flush();
    expect(rows()).toEqual([{ host: 'site.test', granted: false, button: 'Grant' }]);
    expect((await readHosts())[0]!.enabled).toBe(false);
  });

  test('a permission removed outside the page repaints the row', async () => {
    await submit('site.test');
    fakeChrome.permissions.granted.clear();
    fakeChrome.permissions.onRemoved.dispatch({ origins: [originPattern('site.test')] });
    await flush();
    expect(rows()).toEqual([{ host: 'site.test', granted: false, button: 'Grant' }]);
  });

  test('Revoke removes the permission, then the stored entry', async () => {
    await submit('site.test');
    button('site.test').click();
    await flush();
    expect(fakeChrome.permissions.granted.has(originPattern('site.test'))).toBe(false);
    expect(await readHosts()).toEqual([]);
    expect(items().length).toBe(0);
  });

  test('a refused revoke keeps the entry', async () => {
    await submit('site.test');
    fakeChrome.permissions.allowRemove = false;
    button('site.test').click();
    await flush();
    expect(errorText()).toBe('Could not revoke site.test.');
    expect((await readHosts()).map((h) => h.host)).toEqual(['site.test']);
  });

  test('the designer host is saved on blur, normalised, and cleared when blank', async () => {
    await submit('site.test');
    const input = () => items()[0]!.querySelector<HTMLInputElement>('.designer-row input')!;
    input().value = 'HTTPS://Staff.Site.Test/x';
    input().dispatchEvent(new Event('blur'));
    await flush();
    expect((await readHosts())[0]!.designerHost).toBe('staff.site.test');

    input().value = '';
    input().dispatchEvent(new Event('blur'));
    await flush();
    expect('designerHost' in (await readHosts())[0]!).toBe(false);
  });

  test('an invalid designer host is refused', async () => {
    await submit('site.test');
    const input = items()[0]!.querySelector<HTMLInputElement>('.designer-row input')!;
    input.value = 'bad host';
    input.dispatchEvent(new Event('blur'));
    await flush();
    expect(errorText()).toBe('"bad host" is not a valid hostname.');
    expect((await readHosts())[0]!.designerHost).toBe(undefined);
  });

  test('start() is idempotent and stop() removes every listener', async () => {
    page.start();
    expect(listenerCounts()).toEqual(baseline.map((n) => n + 1));
    page.stop();
    page.stop();
    expect(listenerCounts()).toEqual(baseline);

    // Stopped: a host-list change no longer repaints.
    await writeHosts([{ host: 'late.test', enabled: false }]);
    await flush();
    expect(items().length).toBe(0);

    page.start();
    await flush();
    expect(rows().map((r) => r.host)).toEqual(['late.test']);
  });
});
