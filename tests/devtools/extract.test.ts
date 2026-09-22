import { describe, expect, test } from 'bun:test';
import {
  classifyChainUrl,
  extractMethodNameFromChainResponse
} from '../../src/devtools/ad-network/extract';

const UUID = '0123456789abcdef0123456789abcdef';

describe('classifyChainUrl', () => {
  test('definition fetch, v1 and v2', () => {
    expect(classifyChainUrl(`https://h/rest/api/automation/chain/${UUID}`)).toEqual({
      uuid: UUID, kind: 'fetch', version: 'v1'
    });
    expect(classifyChainUrl(`https://h/rest/api/automation/chain/v2/${UUID}?basicInfo=false`)).toEqual({
      uuid: UUID, kind: 'fetch', version: 'v2'
    });
  });

  test('execute and test-execute', () => {
    expect(classifyChainUrl(`https://h/rest/api/automation/chain/execute/${UUID}`)?.kind).toBe('execute');
    expect(classifyChainUrl(`https://h/rest/api/automation/chain/test/execute/${UUID}`)?.kind).toBe('execute');
  });

  test('uuid is lower-cased and taken from the path, not the query', () => {
    const upper = UUID.toUpperCase();
    const other = 'ffffffffffffffffffffffffffffffff';
    expect(classifyChainUrl(`https://h/rest/api/automation/chain/${upper}?ref=${other}`)?.uuid).toBe(UUID);
  });

  test('ignores anything that is not a chain request', () => {
    expect(classifyChainUrl(`https://h/rest/api/other/${UUID}`)).toBeNull();
    expect(classifyChainUrl('https://h/rest/api/automation/chain/list')).toBeNull();
    expect(classifyChainUrl(undefined as any)).toBeNull();
  });
});

describe('extractMethodNameFromChainResponse', () => {
  test('v2 shape, top-level name', () => {
    expect(extractMethodNameFromChainResponse('{"name":" getUser "}')).toBe('getUser');
  });

  test('v2 shape, name under metadata', () => {
    expect(extractMethodNameFromChainResponse({ metadata: { name: 'fromMeta' } })).toBe('fromMeta');
  });

  test('v1 shape, stringified jsonDefinition', () => {
    const body = JSON.stringify({ jsonDefinition: JSON.stringify({ methodName: 'legacy' }) });
    expect(extractMethodNameFromChainResponse(body)).toBe('legacy');
  });

  test.each(['', '   ', 'not json', '[]', '{}', '{"jsonDefinition":"{broken"}'])(
    'no name in %p',
    (body) => {
      expect(extractMethodNameFromChainResponse(body)).toBeNull();
    }
  );
});
