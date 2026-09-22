import { describe, expect, test } from 'bun:test';
import { detectLanguage, LANGUAGE_OPTIONS } from '../../../src/designer/features/textarea-editor/language';

describe('detectLanguage', () => {
  const cases: Array<[string, string, string]> = [
    ['empty', '   ', 'plain'],
    ['prose', 'Just a note about the step', 'plain'],

    ['JSON object', '{"a": 1, "b": [true, null]}', 'json'],
    ['JSON array of numbers', '[1, 2, 3]', 'json'],
    ['JSON being typed (trailing comma)', '{"a": 1,}', 'json'],
    ['mismatched brackets are not JSON', '{ "a": 1 ]', 'plain'],
    ['braced prose is not JSON', '{ just some words }', 'plain'],

    ['SQL statement', 'select id from guardian', 'sql'],
    // The case that motivated testing SQL before SpEL.
    ['SQL interpolating SpEL', "select id from guardian where account_id = '#{userId}'", 'sql'],
    ['SQL after a comment', '-- find them\nselect * from t', 'sql'],
    ['update statement', 'UPDATE t SET a = 1', 'sql'],

    ['SpEL interpolation', '#{user.name}', 'spel'],
    ['SpEL type reference', 'T(java.lang.Math).max(a, b)', 'spel'],
    ['bare and/or is not SpEL', 'a = 1 and b = 2', 'plain'],

    ['Java class', 'public class Foo {\n  private int x;\n}', 'java'],
    ['Java import', 'import java.util.List;', 'java'],

    ['Python def', 'def run(x):\n    return x', 'python'],
    ['Python self', 'value = self.name', 'python'],

    ['JavaScript arrow', 'const f = (x) => x + 1;', 'javascript'],
    ['JavaScript console', 'console.log(1)', 'javascript']
  ];

  for (const [name, text, expected] of cases) {
    test(`${name} -> ${expected}`, () => {
      expect(detectLanguage(text)).toBe(expected);
    });
  }

  test('every detectable mode is offered in the dropdown', () => {
    const offered = new Set(LANGUAGE_OPTIONS.map((o) => o.value));
    for (const [, , mode] of cases) expect(offered.has(mode)).toBe(true);
  });
});
