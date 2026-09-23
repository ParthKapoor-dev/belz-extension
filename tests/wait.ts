// Waiting in tests without guessing how long something takes.
//
// Prefer waitFor(condition) over a fixed sleep: it returns as soon as the
// condition holds, and its timeout is generous, so a slow machine does not
// turn into a flaky failure. A fixed wait is only right for proving that
// something does NOT happen, and then with a wide margin.

/** Resolves after every task queued before it: timers at 0 ms, storage.onChanged in the fake. */
export const nextTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Resolves after `ms` milliseconds. Only to show that nothing happens. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves once `condition()` is truthy, checking every few ms; rejects after
 * `timeoutMs` with `what` in the message.
 */
export async function waitFor(condition: () => unknown, what = 'condition', timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(5);
  }
}
