import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TitleUpdater } from '../../../src/designer/features/title-updater/index';

// The tab title follows the open method; stop() gives the page its title back.
// The test page is on /automation-designer/ (see tests/setup.ts).

const updater = new TitleUpdater();

beforeEach(() => {
  document.title = 'Service Designer';
  document.body.innerHTML = '<input id="SD1_MethodName" value="getUser">';
});
afterEach(() => updater.stop());

describe('TitleUpdater', () => {
  test('names the tab after the method, and stop() restores the page\'s title', () => {
    updater.start();
    expect(document.title).toBe('AD: getUser');
    updater.stop();
    expect(document.title).toBe('Service Designer');
  });

  test('a title the app set after ours is the app\'s: stop() leaves it', () => {
    updater.start();
    document.title = 'Something the app chose';
    updater.stop();
    expect(document.title).toBe('Something the app chose');
  });

  test('started again, it writes the title again', () => {
    updater.start();
    updater.stop();
    updater.start();
    expect(document.title).toBe('AD: getUser');
  });
});
