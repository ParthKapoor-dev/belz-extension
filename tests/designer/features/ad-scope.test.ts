import { beforeEach, describe, expect, test } from 'bun:test';
import { fieldCodeName, scanScope, stepIndexOf } from '../../../src/designer/features/ad-scope/scan';
import type { VariableScope } from '../../../src/designer/features/ide/scope';
import { renderAdScope, renderStepOutput } from '../../fixtures/ad-scope';

const textarea = (id: string): HTMLTextAreaElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`fixture has no #${id}`);
  return el as HTMLTextAreaElement;
};

/** A scope as plain strings: name:kind[:step]:in|out. */
const summary = (scope: VariableScope): string[] =>
  scope.variables.map((v) =>
    [v.name, v.kind, ...(v.step === undefined ? [] : [String(v.step)]), v.inScope ? 'in' : 'out'].join(':'));

const scanAt = (id: string) => scanScope(document, textarea(id));

describe('scanScope', () => {
  beforeEach(() => {
    renderAdScope(['reportCodes', 'userId'], ['varGuardStorage'], [
      { outputs: ['stepOneOut'] },
      { outputs: ['stepTwoOut', 'varGuardStorage'] },
      { outputs: ['stepThreeOut'] }
    ]);
  });

  test('step 3.1: inputs and internal variables only; every output is later', () => {
    const scope = scanAt('ta0');
    expect(scope.step).toBe(0);
    expect(summary(scope)).toEqual([
      'reportCodes:input:in',
      'userId:input:in',
      'varGuardStorage:variable:in',
      'stepOneOut:output:0:out',
      'stepTwoOut:output:1:out',
      'stepThreeOut:output:2:out'
    ]);
  });

  test('step 3.2 sees the outputs of step 3.1', () => {
    const scope = scanAt('ta1');
    expect(scope.step).toBe(1);
    expect(summary(scope).filter((s) => s.endsWith(':in'))).toEqual([
      'reportCodes:input:in', 'userId:input:in', 'varGuardStorage:variable:in', 'stepOneOut:output:0:in'
    ]);
  });

  test('step 3.3 sees the outputs of 3.1 and 3.2, not its own', () => {
    const scope = scanAt('ta2');
    expect(scope.step).toBe(2);
    expect(summary(scope).slice(3)).toEqual([
      'stepOneOut:output:0:in', 'stepTwoOut:output:1:in', 'stepThreeOut:output:2:out'
    ]);
  });

  test('outside any step, everything is in scope', () => {
    for (const id of ['taInputs', 'taOutputs']) {
      const scope = scanAt(id);
      expect(scope.step).toBeNull();
      expect(scope.variables.every((v) => v.inScope)).toBe(true);
      expect(scope.variables.length).toBe(6);
    }
  });

  test('an output written into a declared variable stays the declared variable', () => {
    const names = scanAt('ta2').variables.map((v) => v.name);
    expect(names.filter((n) => n === 'varGuardStorage').length).toBe(1);
  });

  test('re-scanning reads the page as it is now: a new step and a rename both show', () => {
    expect(scanAt('ta2').variables.map((v) => v.name)).toContain('stepOneOut');

    // Rename an output of step 3.1 and add an output to step 3.2, as a draft edit would.
    const first = document.querySelector('#step3_0 div.mt1.font-size-smallest');
    if (!first) throw new Error('fixture has no step output');
    first.textContent = 'Field Code : #{renamedOut}';
    document.querySelector('#step3_1 .outputs')!.insertAdjacentHTML('beforeend', renderStepOutput('addedOut'));

    const names = scanAt('ta2').variables.map((v) => v.name);
    expect(names).toContain('renamedOut');
    expect(names).toContain('addedOut');
    expect(names).not.toContain('stepOneOut');
  });

  test('an empty page has no variables', () => {
    document.body.innerHTML = '<textarea id="lonely"></textarea>';
    const scope = scanAt('lonely');
    expect(scope.step).toBeNull();
    expect(scope.variables.length).toBe(0);
  });
});

describe('field-code parsing', () => {
  test('both spellings, and stray whitespace', () => {
    expect(fieldCodeName('Field Code: #{reportCodes}')).toBe('reportCodes');
    expect(fieldCodeName('Field Code : #{varGuardStorage}')).toBe('varGuardStorage');
    expect(fieldCodeName('  Field Code   :#{ spaced }  ')).toBe('spaced');
    expect(fieldCodeName('Field Code\n:\n#{multi}')).toBe('multi');
  });

  test('anything else is not a field code', () => {
    expect(fieldCodeName('Field Code: none')).toBeNull();
    expect(fieldCodeName('#{x}')).toBeNull();
    expect(fieldCodeName(null)).toBeNull();
    expect(fieldCodeName('Field Code: #{   }')).toBeNull();
  });

  test('step index from the step id', () => {
    renderAdScope([], [], [{ outputs: [] }, { outputs: [] }]);
    expect(stepIndexOf(textarea('ta1'))).toBe(1);
    expect(stepIndexOf(textarea('taInputs'))).toBeNull();
  });
});
