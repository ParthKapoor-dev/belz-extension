import { afterEach, describe, expect, test } from 'bun:test';
import { ApiError, isRetryableError, type MethodResolver } from '../../src/devtools/ad-network/api';
import { MethodNames, ResolveQueue, type RetryPolicy } from '../../src/devtools/ad-network/names';
import { sleep, waitFor } from '../wait';

// ResolveQueue retries a failed resolve only when the failure may clear on its
// own (isRetryableError), backing off, and gives a uuid up after a fixed
// number of failures; any other failure, and a null summary, is final.

describe('isRetryableError', () => {
  test.each([
    ['unreachable host', new ApiError('cannot reach', undefined, true), true],
    ['no HTTP status (origin unknown, non-JSON)', new ApiError('origin unknown'), true],
    ['401', new ApiError('x', 401), true],
    ['403', new ApiError('x', 403), true],
    ['408', new ApiError('x', 408), true],
    ['429', new ApiError('x', 429), true],
    ['503', new ApiError('x', 503), true],
    ['404', new ApiError('x', 404), false],
    ['400', new ApiError('x', 400), false],
    ['a final error (not an allowed site)', new ApiError('x', undefined, false, true), false],
    ['a non-ApiError', new TypeError('boom'), true]
  ])('%s', (_label, err, retry) => {
    expect(isRetryableError(err)).toBe(retry);
  });
});

describe('ResolveQueue', () => {
  let queue: ResolveQueue | null = null;
  afterEach(() => queue?.stop());

  /** Retries fast enough for a test: 20 ms, then 40, capped at 40; 3 attempts. */
  const FAST: RetryPolicy = { first: 20, max: 40, attempts: 3 };

  function setup(resolve: (uuid: string) => Promise<unknown>, retry: RetryPolicy = FAST) {
    const calls: string[] = [];
    const outcomes: [boolean, string][] = [];
    const names = new MethodNames(() => {});
    const resolver = {
      resolveSummary: (uuid: string) => {
        calls.push(uuid);
        return resolve(uuid);
      }
    } as unknown as MethodResolver;
    queue = new ResolveQueue(resolver, names, async () => {}, (failed, reason) => outcomes.push([failed, reason]), retry);
    return { calls, outcomes, names, queue, retryPending: () => (queue as unknown as { retryTimer: unknown }).retryTimer !== null };
  }

  test('learns the name and category of a resolved uuid', async () => {
    const { names, queue: q, outcomes } = setup(async () => ({ name: 'getUser', category: 'Users' }));
    q.add('u1');
    await waitFor(() => outcomes.length === 1, 'the first batch');
    expect([names.name('u1'), names.category('u1')]).toEqual(['getUser', 'Users']);
    expect(outcomes).toEqual([[false, '']]);
  });

  test('a retryable failure is queued for a retry', async () => {
    const { queue: q, outcomes, retryPending } = setup(async () => {
      throw new ApiError('not signed in to this site (HTTP 401)', 401);
    }, { first: 60_000, max: 60_000, attempts: 3 });
    q.add('u1');
    await waitFor(() => outcomes.length === 1, 'the first batch');
    expect(outcomes).toEqual([[true, 'not signed in to this site (HTTP 401)']]);
    expect(retryPending()).toBe(true);
  });

  test('a retryable failure that persists is given up after the last attempt', async () => {
    const { queue: q, calls, retryPending } = setup(async () => {
      throw new ApiError('HTTP 503', 503);
    });
    q.add('u1');
    await waitFor(() => calls.length === FAST.attempts, 'every attempt');
    await waitFor(() => !retryPending(), 'the queue to give up');
    await sleep(150); // well past the longest retry wait: no more attempts
    expect(calls.length).toBe(FAST.attempts);
    q.add('u1'); // given up: adding it again does nothing either
    await sleep(300);
    expect(calls.length).toBe(FAST.attempts);
  });

  test('retries back off, up to the maximum wait', () => {
    const { queue: q } = setup(async () => null, { first: 4000, max: 60_000, attempts: 5 });
    expect([1, 2, 3, 4, 5, 6].map((n) => q.retryDelay(n))).toEqual([4000, 8000, 16000, 32000, 60000, 60000]);
  });

  test('a definite HTTP error is reported but not retried', async () => {
    const { queue: q, outcomes, retryPending } = setup(async () => {
      throw new ApiError('v2: HTTP 404 · v1: HTTP 404', 404);
    });
    q.add('u1');
    await waitFor(() => outcomes.length === 1, 'the first batch');
    expect(outcomes).toEqual([[true, 'v2: HTTP 404 · v1: HTTP 404']]);
    expect(retryPending()).toBe(false);
  });

  test('a null summary is final', async () => {
    const { queue: q, calls, outcomes, retryPending } = setup(async () => null);
    q.add('u1');
    await waitFor(() => outcomes.length === 1, 'the first batch');
    expect(calls).toEqual(['u1']);
    expect(retryPending()).toBe(false);
  });

  test('stop() drops queued uuids before they are resolved', async () => {
    const { queue: q, calls } = setup(async () => ({ name: 'x', category: 'y' }));
    q.add('u1');
    q.stop();
    await sleep(600); // more than twice the 250 ms debounce: nothing may run
    expect(calls).toEqual([]);
  });
});
