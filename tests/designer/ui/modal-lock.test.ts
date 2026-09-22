import { describe, expect, test } from 'bun:test';
import { ModalLock } from '../../../src/designer/ui/modal-lock';

describe('modal lock', () => {
  const lock = new ModalLock();

  test('counts nested locks and restores the page only on the last unlock', () => {
    document.body.style.overflow = 'auto';
    lock.lock();
    lock.lock(); // e.g. settings opened from inside the editor
    expect(lock.isLocked).toBe(true);
    expect(document.body.style.position).toBe('fixed');

    lock.unlock();
    expect(lock.isLocked).toBe(true);
    expect(document.body.style.position).toBe('fixed');

    lock.unlock();
    expect(lock.isLocked).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(document.body.style.overflow).toBe('auto');
  });

  test('an extra unlock is harmless', () => {
    lock.unlock();
    expect(lock.isLocked).toBe(false);
    lock.lock();
    expect(lock.isLocked).toBe(true);
    lock.unlock();
  });
});
