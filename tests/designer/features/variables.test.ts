import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { variableCompletionSource } from '../../../src/designer/features/textarea-editor/variables';
import {
  describeVariable,
  findExpressions,
  isInsideExpression,
  lintReferences,
  referenceAt,
  scopeStatus
} from '../../../src/designer/features/textarea-editor/references';
import type { VariableScope } from '../../../src/designer/features/textarea-editor/scope';

// Editing step 3.2: step 3.1's output is in scope, step 3.3's is not.
const SCOPE: VariableScope = {
  step: 1,
  variables: [
    { name: 'reportCodes', kind: 'input', inScope: true },
    { name: 'varGuardStorage', kind: 'variable', inScope: true },
    { name: 'firstOut', kind: 'output', step: 0, inScope: true },
    { name: 'laterOut', kind: 'output', step: 2, inScope: false }
  ]
};

/** Completion at `|` in `doc`, as plain data. */
function complete(doc: string, explicit = false): { from: number; labels: string[]; applies: string[] } | null {
  const pos = doc.indexOf('|');
  const text = doc.replace('|', '');
  const state = EditorState.create({ doc: text });
  const result = variableCompletionSource(SCOPE)(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
  if (!result) return null;
  return {
    from: result.from,
    labels: result.options.map((o) => o.label),
    applies: result.options.map((o) => String(o.apply))
  };
}

describe('variable completion', () => {
  test('right after #{ it offers every variable, closing the brace', () => {
    const result = complete('select #{|');
    expect(result?.from).toBe(9);
    expect(result?.labels).toEqual(['reportCodes', 'varGuardStorage', 'firstOut', 'laterOut']);
    expect(result?.applies[0]).toBe('reportCodes}');
  });

  test('no second brace when closeBrackets already added one', () => {
    expect(complete('#{rep|}')?.applies[0]).toBe('reportCodes');
  });

  test('outputs not produced yet sort last and say so', () => {
    const later = describeVariable(SCOPE.variables[3]!);
    expect(later.detail).toBe('step 3.3 (later)');
    expect(describeVariable(SCOPE.variables[2]!).info).toBe('Output of step 3.1');
    expect(describeVariable(SCOPE.variables[0]!).info).toBe('Input');
    expect(describeVariable(SCOPE.variables[1]!).info).toBe('Internal variable');
  });

  test('bare names inside an open SpEL expression', () => {
    const result = complete('#{reportCodes == null or var|');
    expect(result?.from).toBe(25);
    expect(result?.applies[1]).toBe('varGuardStorage');
  });

  test('after #{name. it offers element', () => {
    const result = complete('#{reportCodes.|');
    expect(result?.labels).toEqual(['element']);
    expect(result?.from).toBe(14);
    expect(result?.applies).toEqual(['element}']);
  });

  test('nothing outside #{ … }, after an unknown root, or after a member dot', () => {
    expect(complete('select rep|')).toBeNull();
    expect(complete('#{a} and rep|')).toBeNull();
    expect(complete('#{unknown.|')).toBeNull();
  });
});

describe('expressions', () => {
  test('nested braces and string literals', () => {
    const text = "#{ {1,2}.contains(x) } and #{a == '}'} and #{open";
    expect(findExpressions(text).map((e) => e.to === null ? 'open' : text.slice(e.from, e.to)))
      .toEqual(['#{ {1,2}.contains(x) }', "#{a == '}'}", 'open']);
  });

  test('inside an open expression, not after a closed one', () => {
    expect(isInsideExpression('x #{a + ')).toBe(true);
    expect(isInsideExpression('x #{a} + ')).toBe(false);
    expect(isInsideExpression('plain')).toBe(false);
  });
});

describe('variable lint', () => {
  const messages = (text: string, scope = SCOPE) => lintReferences(text, scope).map((d) => d.message);

  test('known, in-scope references are clean', () => {
    expect(messages("select * from t where id = '#{reportCodes}' and g = #{ firstOut.element }")).toEqual([]);
  });

  test('unknown names, later outputs and unclosed #{', () => {
    expect(messages('#{nope} #{laterOut} #{reportCodes')).toEqual([
      "Unknown variable 'nope'",
      "'laterOut' is the output of step 3.3, which has not run yet (this is step 3.2)",
      'Unclosed #{ — no matching }'
    ]);
  });

  test('the warning covers the name only', () => {
    const [d] = lintReferences('ab #{ nope.x }', SCOPE);
    expect([d?.from, d?.to]).toEqual([6, 10]);
  });

  test('complex SpEL, keywords and #this are left alone', () => {
    expect(messages("#{nope == null or nope.size() > 0} #{T(java.lang.Math).max(1, 2)} #{#this} #{true} #{'x'}"))
      .toEqual([]);
  });

  test('no unknown-name noise when the page offered no variables', () => {
    expect(messages('#{anything}', { step: null, variables: [] })).toEqual([]);
  });
});

describe('hover and status', () => {
  test('a known name inside #{ … } is described', () => {
    const text = '#{a == null or firstOut.size()}';
    const ref = referenceAt(text, text.indexOf('firstOut') + 3, SCOPE);
    expect(ref?.variable.name).toBe('firstOut');
    expect([ref?.from, ref?.to]).toEqual([15, 23]);
  });

  test('outside #{ … }, a member, or an unknown name: nothing', () => {
    expect(referenceAt('firstOut', 2, SCOPE)).toBeNull();
    expect(referenceAt('#{x.firstOut}', 6, SCOPE)).toBeNull();
    expect(referenceAt('#{nope}', 3, SCOPE)).toBeNull();
  });

  test('footer status counts what is in scope', () => {
    expect(scopeStatus(SCOPE)).toBe('Step 3.2 · 3 variables in scope');
    expect(scopeStatus({ step: null, variables: [SCOPE.variables[0]!] })).toBe('Outside steps · 1 variable in scope');
  });
});
