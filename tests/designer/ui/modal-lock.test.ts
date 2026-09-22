import { describe, expect, test } from 'bun:test';
import {
  isModalInteractionLocked,
  lockModalInteraction,
  unlockModalInteraction
} from '../../../src/designer/ui/modal-lock';

describe('modal lock', () => {
  test('counts nested locks and restores the page only on the last unlock', () => {
    document.body.style.overflow = 'auto';
    lockModalInteraction();
    lockModalInteraction(); // e.g. settings opened from inside the editor
    expect(isModalInteractionLocked()).toBe(true);
    expect(document.body.style.position).toBe('fixed');

    unlockModalInteraction();
    expect(isModalInteractionLocked()).toBe(true);
    expect(document.body.style.position).toBe('fixed');

    unlockModalInteraction();
    expect(isModalInteractionLocked()).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(document.body.style.overflow).toBe('auto');
  });

  test('an extra unlock is harmless', () => {
    unlockModalInteraction();
    expect(isModalInteractionLocked()).toBe(false);
    lockModalInteraction();
    expect(isModalInteractionLocked()).toBe(true);
    unlockModalInteraction();
  });
});
