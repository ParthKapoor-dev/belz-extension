import { afterEach, describe, expect, test } from 'bun:test';
import { ApiError, isRetryableError, type MethodResolver } from '../../src/devtools/ad-network/api';
import { MethodNames, ResolveQueue } from '../../src/devtools/ad-network/names';

// ResolveQueue retries a failed resolve only when the failure may clear on its
// own (isRetryableError); any other failure, and a null summary, is final.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Past the queue's 250 ms debounce, and the flush that follows. */
const settle = () => sleep(300);

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
    ['a non-ApiError', new TypeError('boom'), true]
  ])('%s', (_label, err, retry) => {
    expect(isRetryableError(err)).toBe(retry);
  });
});

describe('ResolveQueue', () => {
  let queue: ResolveQueue | null = null;
  afterEach(() => queue?.stop());

  function setup(resolve: (uuid: string) => Promise<unknown>) {
    const calls: string[] = [];
    const outcomes: [boolean, string][] = [];
    const names = new MethodNames(() => {});
    const resolver = {
      resolveSummary: (uuid: string) => {
        calls.push(uuid);
        return resolve(uuid);
      }
    } as unknown as MethodResolver;
    queue = new ResolveQueue(resolver, names, async () => {}, (failed, reason) => outcomes.push([failed, reason]));
    return { calls, outcomes, names, queue, retryPending: () => (queue as unknown as { retryTimer: unknown }).retryTimer !== null };
  }

  test('learns the name and category of a resolved uuid', async () => {
    const { names, queue: q, outcomes } = setup(async () => ({ name: 'getUser', category: 'Users' }));
    q.add('u1');
    await settle();
    expect([names.name('u1'), names.category('u1')]).toEqual(['getUser', 'Users']);
    expect(outcomes).toEqual([[false, '']]);
  });

  test('a retryable failure is queued for a retry', async () => {
    const { queue: q, outcomes, retryPending } = setup(async () => {
      throw new ApiError('not signed in to this site (HTTP 401)', 401);
    });
    q.add('u1');
    await settle();
    expect(outcomes).toEqual([[true, 'not signed in to this site (HTTP 401)']]);
    expect(retryPending()).toBe(true);
  });

  test('a definite HTTP error is reported but not retried', async () => {
    const { queue: q, outcomes, retryPending } = setup(async () => {
      throw new ApiError('v2: HTTP 404 · v1: HTTP 404', 404);
    });
    q.add('u1');
    await settle();
    expect(outcomes).toEqual([[true, 'v2: HTTP 404 · v1: HTTP 404']]);
    expect(retryPending()).toBe(false);
  });

  test('a null summary is final', async () => {
    const { queue: q, calls, retryPending } = setup(async () => null);
    q.add('u1');
    await settle();
    expect(calls).toEqual(['u1']);
    expect(retryPending()).toBe(false);
  });

  test('stop() drops queued uuids before they are resolved', async () => {
    const { queue: q, calls } = setup(async () => ({ name: 'x', category: 'y' }));
    q.add('u1');
    q.stop();
    await settle();
    expect(calls).toEqual([]);
  });
});
