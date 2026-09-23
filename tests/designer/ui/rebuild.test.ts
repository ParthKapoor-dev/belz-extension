import { afterEach, describe, expect, test } from 'bun:test';
import { Toast } from '../../../src/designer/ui/toast';
import { modalLock } from '../../../src/designer/ui/modal-lock';
import { settings } from '../../../src/designer/core/settings';
import { SettingsModal } from '../../../src/designer/features/settings/modal';
import { EXTENSION_OWNED_ATTR, ns, nsAttr } from '../../../src/config/namespace';

// The host app can wipe and re-render <body>, taking the extension's cached
// elements with it. Toast and the modals must notice (isConnected) and rebuild
// rather than write into a detached element. Also: the settings modal follows
// the settings store while open. Assertions read plain values only.

const SETTINGS_MODAL_ID = ns('SettingsModal');
const checkbox = (key: string) =>
  document.querySelector<HTMLInputElement>(`#${SETTINGS_MODAL_ID} input[${nsAttr('setting-key')}="${key}"]`)!;
const owned = () => document.body.querySelectorAll(`[${EXTENSION_OWNED_ATTR}]`).length;

afterEach(() => {
  document.body.innerHTML = '';
  while (modalLock.isLocked) modalLock.unlock();
});

describe('Toast', () => {
  test('is marked as extension-owned and rebuilt after the body is wiped', () => {
    const toast = new Toast();
    toast.show('first');
    expect(owned()).toBe(1);

    document.body.innerHTML = '<main>re-rendered</main>';
    toast.show('second');
    const els = [...document.body.querySelectorAll(`[${EXTENSION_OWNED_ATTR}]`)];
    expect(els.map((e) => e.textContent)).toEqual(['second']);
  });
});

describe('SettingsModal', () => {
  test('repaints while open when the settings change elsewhere, and stops on close', () => {
    const modal = new SettingsModal();
    settings.set('titleUpdater', true);
    modal.open();
    expect(checkbox('titleUpdater').checked).toBe(true);

    settings.set('titleUpdater', false); // e.g. another tab
    expect(checkbox('titleUpdater').checked).toBe(false);

    modal.close();
    settings.set('titleUpdater', true);
    expect(checkbox('titleUpdater').checked).toBe(false);
    expect(modalLock.isLocked).toBe(false);
    modal.dispose();
    settings.set('titleUpdater', true);
  });

  test('a modal wiped while open releases the lock and is rebuilt on the next open', () => {
    const modal = new SettingsModal();
    modal.open();
    expect(modalLock.isLocked).toBe(true);

    document.body.innerHTML = '<main>re-rendered</main>';
    modal.open();
    expect(document.getElementById(SETTINGS_MODAL_ID) === null).toBe(false);
    expect(modal.isOpen).toBe(true);
    modal.close();
    // One lock taken by the rebuilt modal, released by close: none left over.
    expect(modalLock.isLocked).toBe(false);
    modal.dispose();
    expect(document.getElementById(SETTINGS_MODAL_ID) === null).toBe(true);
  });
});
