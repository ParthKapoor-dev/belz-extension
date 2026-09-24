import { afterEach, describe, expect, test } from 'bun:test';
import { DISCARD_PROMPT, FooterStatus } from '../../../src/designer/features/ide/footer';
import { waitFor } from '../../wait';

// The IDE footer's status line, with short windows so expiry can be waited
// for. Assertions read plain strings.

let shown: string[];
let footer: FooterStatus;
const line = () => shown.at(-1);

function makeFooter(discardMs: number, messageMs: number): FooterStatus {
  shown = [];
  footer = new FooterStatus((text) => shown.push(text), { discardMs, messageMs });
  footer.reset('base');
  return footer;
}

afterEach(() => footer.clear());

describe('FooterStatus', () => {
  test('the discard prompt ends by itself: the window closes and the line comes back', async () => {
    makeFooter(30, 1000);
    footer.armDiscard();
    expect([line(), footer.discardArmed]).toEqual([DISCARD_PROMPT, true]);
    await waitFor(() => !footer.discardArmed, 'the discard window to close');
    expect(line()).toBe('base');
  });

  test('a message under an armed prompt waits, and shows once the prompt is gone', async () => {
    makeFooter(30, 5000);
    footer.armDiscard();
    footer.showMessage('Already formatted', false);
    expect(line()).toBe(DISCARD_PROMPT);
    await waitFor(() => !footer.discardArmed, 'the discard window to close');
    expect(line()).toBe('Already formatted');
  });

  test('an edit takes the prompt back; the message, when it expires, gives way to the line', async () => {
    makeFooter(5000, 30);
    footer.showMessage('Formatted', false);
    footer.armDiscard();
    footer.disarmDiscard();
    expect([line(), footer.discardArmed]).toEqual(['Formatted', false]);
    await waitFor(() => line() === 'base', 'the message to expire');
  });

  test('reset() drops everything pending', () => {
    makeFooter(5000, 5000);
    footer.armDiscard();
    footer.showMessage('x', true);
    footer.reset('next open');
    expect([line(), footer.discardArmed]).toEqual(['next open', false]);
  });
});
