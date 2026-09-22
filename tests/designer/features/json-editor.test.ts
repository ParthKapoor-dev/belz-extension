import { describe, expect, test } from 'bun:test';
import { renderInputs } from '../../fixtures/ad-inputs';
import { extractAllInputs } from '../../../src/designer/features/json-editor/extractor';
import { syncJSONToInputs } from '../../../src/designer/features/json-editor/sync';

// Extracted inputs hold live DOM nodes (testValueElement, container). Never
// pass one to expect(): if the assertion fails, bun prints the value, and
// printing a DOM node walks the whole document — see tests/memory-guard-worker.ts.
// Assert on these plain summaries instead.
function summary(input: any) {
  return {
    key: input.key,
    name: input.name,
    type: input.type,
    mandatory: input.mandatory,
    currentValue: input.currentValue,
    control: input.testValueElement
      ? `${input.testValueElement.tagName.toLowerCase()}${input.testValueElement.type ? ':' + input.testValueElement.type : ''}`
      : null
  };
}
const extract = (force = true) => extractAllInputs(force).map(summary);
const byKey = (inputs: ReturnType<typeof summary>[]) =>
  Object.fromEntries(inputs.map((i) => [i.key, i]));

describe('extractAllInputs', () => {
  test('reads key, name, type, mandatory and current value per input', () => {
    renderInputs([
      { key: 'userId', type: 'Text', name: 'User id', mandatory: true, value: 'u-1' },
      { key: 'count', type: 'Integer', value: '3' },
      { key: 'active', type: 'Boolean', value: 'Yes' },
      { key: 'payload', type: 'Structured Data', value: '{"a":1}' },
      { key: 'upload', type: 'File' }
    ]);
    const inputs = byKey(extract());

    expect(Object.keys(inputs)).toEqual(['userId', 'count', 'active', 'payload', 'upload']);
    expect(inputs.userId).toEqual({
      key: 'userId', name: 'User id', type: 'Text', mandatory: true, currentValue: 'u-1', control: 'textarea:textarea'
    });
    expect(inputs.count).toMatchObject({ type: 'Integer', mandatory: false, currentValue: '3', control: 'input:number' });
    expect(inputs.active).toMatchObject({ type: 'Boolean', currentValue: 'Yes', control: 'exp-select' });
    expect(inputs.payload).toMatchObject({ type: 'StructuredData', currentValue: '{"a":1}' });
    expect(inputs.upload.control).toBe('input:file');
  });

  test('falls back to the key when there is no name', () => {
    renderInputs([{ key: 'k', type: 'Text' }]);
    expect(extract()[0].name).toBe('k');
  });

  test('an empty page has no inputs', () => {
    document.body.innerHTML = '<p>nothing here</p>';
    expect(extract()).toEqual([]);
  });

  test('results are cached briefly unless a refresh is forced', () => {
    renderInputs([{ key: 'a', type: 'Text' }]);
    expect(extract(true)).toHaveLength(1);
    renderInputs([{ key: 'a', type: 'Text' }, { key: 'b', type: 'Text' }]);
    expect(extract(false)).toHaveLength(1);
    expect(extract(true)).toHaveLength(2);
  });
});

describe('syncJSONToInputs', () => {
  test('fills text, number and boolean inputs and reports the count', async () => {
    renderInputs([
      { key: 'name', type: 'Text' },
      { key: 'count', type: 'Integer' },
      { key: 'active', type: 'Boolean', value: 'No' },
      { key: 'meta', type: 'Json' }
    ]);
    const result = await syncJSONToInputs(JSON.stringify({ name: 'Ann', count: 4, active: true, meta: { a: 1 } }));

    expect(result).toMatchObject({ success: true, filledCount: 4, failedKeys: [], skippedMissingKeys: [] });
    const inputs = byKey(extract());
    expect(inputs.name.currentValue).toBe('Ann');
    expect(inputs.count.currentValue).toBe('4');
    expect(inputs.active.currentValue).toBe('Yes');
    expect(JSON.parse(inputs.meta.currentValue)).toEqual({ a: 1 });
  });

  test('fires input and change events so the page registers the edit', async () => {
    renderInputs([{ key: 'name', type: 'Text' }]);
    const seen: string[] = [];
    const textarea = document.querySelector('textarea')!;
    textarea.addEventListener('input', () => seen.push('input'));
    textarea.addEventListener('change', () => seen.push('change'));
    await syncJSONToInputs('{"name":"x"}');
    expect(seen).toContain('input');
    expect(seen).toContain('change');
  });

  test('warns about keys that are not on the page, still succeeds', async () => {
    renderInputs([{ key: 'name', type: 'Text' }]);
    const result = await syncJSONToInputs('{"name":"x","ghost":1}');
    expect(result.success).toBe(true);
    expect(result.skippedMissingKeys).toEqual(['ghost']);
    expect((result.warnings ?? []).join(' ')).toContain('ghost');
  });

  test('skips file inputs with a warning', async () => {
    renderInputs([{ key: 'name', type: 'Text' }, { key: 'upload', type: 'File' }]);
    const result = await syncJSONToInputs('{"name":"x","upload":"a.pdf"}');
    expect(result.filledCount).toBe(1);
    expect((result.warnings ?? []).join(' ')).toContain('File input(s) skipped');
  });

  test('reports an invalid value without touching the input', async () => {
    renderInputs([{ key: 'count', type: 'Integer', value: '1' }]);
    const result = await syncJSONToInputs('{"count":"many"}');
    expect(result.success).toBe(false);
    expect(result.failedKeys).toEqual(['count']);
    expect(byKey(extract()).count.currentValue).toBe('1');
  });

  test.each([
    ['not JSON', '{oops', 'Invalid JSON'],
    ['an array', '[1,2]', 'must be an object'],
    ['null', 'null', 'must be an object']
  ])('rejects %s', async (_label, json, message) => {
    renderInputs([{ key: 'a', type: 'Text' }]);
    const result = await syncJSONToInputs(json);
    expect(result.success).toBe(false);
    expect((result.errors ?? []).join(' ')).toContain(message);
  });

  test('explains when the page has no inputs at all', async () => {
    document.body.innerHTML = '';
    const result = await syncJSONToInputs('{"a":1}');
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('No inputs found');
  });
});
