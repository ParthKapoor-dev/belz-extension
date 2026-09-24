import { describe, expect, test } from 'bun:test';
import { formatCode, mapPosition, type FormatResult } from '../../../src/designer/features/ide/format';

/** The formatted text; fails the test with the error when there is one. */
function formatted(result: FormatResult): string {
  if (!result.ok) throw new Error(`expected a result, got: ${result.error}`);
  return result.text;
}

const sql = (text: string) => formatted(formatCode(text, 'sql'));
const json = (text: string) => formatted(formatCode(text, 'json'));

describe('formatCode: SQL', () => {
  test('lays out a query, keywords upper case', () => {
    expect(sql('select a, b from t where x = 1')).toBe(
      'SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1'
    );
  });

  test('keeps #{ } placeholders exactly, spaces, quotes and braces included', () => {
    const placeholders = [
      '#{a}',
      '#{x.element}',
      '#{ userId }',
      `#{'{"k":' + v + '}'}`,
      '#{a == null ? 0 : a.size()}',
      '#{T(java.lang.Math).max(a, (b + 1))}'
    ];
    const out = sql(
      `select * from t where a = ${placeholders[0]} and b = '${placeholders[1]}'` +
      ` and c = ${placeholders[2]} and d = ${placeholders[3]}::jsonb` +
      ` and e = ${placeholders[4]} and f in (${placeholders[5]})`
    );
    for (const placeholder of placeholders) {
      expect(out.split(placeholder).length - 1).toBe(1);
    }
    expect(out).toContain(`d = ${placeholders[3]}::jsonb`);
    expect(out).toContain(`b = '${placeholders[1]}'`);
  });

  test('a placeholder used as a name or joined to one stays whole', () => {
    const out = sql('select #{col} from s.#{table} where x = pre_#{suffix}');
    expect(out).toContain('#{col}');
    expect(out).toContain('s.#{table}');
    expect(out).toContain('pre_#{suffix}');
  });

  test(':name parameters, ::casts and jsonb operators survive', () => {
    const out = sql(
      "select a->>'k', b->'j', c #> '{a,b}', c #>> '{a}', d::jsonb, e ?| array['x'], f @> '{}'::jsonb, g ? 'k' " +
      'from t where id = :userId and n = :n::int'
    );
    for (const piece of [
      "a ->> 'k'", "b -> 'j'", "c #> '{a,b}'", "c #>> '{a}'", 'd::jsonb',
      "e ?| ARRAY['x']", "f @> '{}'::jsonb", "g ? 'k'", 'id = :userId', 'n = :n::int'
    ]) {
      expect(out).toContain(piece);
    }
  });

  test('several statements, one blank line apart', () => {
    expect(sql('select 1; update t set a = #{v} where id = :id')).toBe(
      'SELECT\n  1;\n\nUPDATE t\nSET\n  a = #{v}\nWHERE\n  id = :id'
    );
  });

  test('formatted text comes back identical', () => {
    const once = sql("select a, b from t where x = '#{y}' and z = :p");
    expect(sql(once)).toBe(once);
  });

  test('the whitespace around the text is kept', () => {
    expect(sql('\n  select 1\n')).toBe('\n  SELECT\n  1\n');
  });

  test('an unclosed #{ is an error, not a guess', () => {
    const result = formatCode('select 1\nfrom t where a = #{x', 'sql');
    expect(result).toEqual({ ok: false, error: 'Unclosed #{ on line 2' });
  });

  test('data types stay lower case, casts to arrays included; names stay as written', () => {
    const out = sql("select a::text[], b::INT, c::UUID[], MyCol, t.Text[1], 'TEXT[x]', e ?| array['x'] from t");
    for (const piece of ['a::text[]', 'b::int', 'c::uuid[]', 'MyCol', 't.Text[1]', "'TEXT[x]'", "ARRAY['x']"]) {
      expect(out).toContain(piece);
    }
  });

  test('text that does not start like a SQL statement is refused, not laid out', () => {
    expect(formatCode('selec from where', 'sql')).toEqual({ ok: false, error: 'Doesn\'t look like SQL: it starts with "SELEC"' });
    expect(formatCode('hello world', 'sql').ok).toBe(false);
    // Comments, placeholders and parentheses before the first word are skipped.
    expect(sql('-- q\n/* c */ ((select 1)) union (select 2)')).toContain('SELECT');
    expect(sql('#{prefix} select 1')).toContain('SELECT');
    expect(sql('#{wholeQuery}')).toBe('#{wholeQuery}');
  });

  test('sql-formatter failing leaves the text alone and names the document line', () => {
    const result = formatCode('select 1;\nselect (1', 'sql', { line: 7, indent: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toStartWith('Parse error');
      expect(result.error).toEndWith('(line 8)');
    }
  });

  test('errors name the document line of a selection, and count leading blank lines', () => {
    expect(formatCode('select 1\nfrom t where a = #{x', 'sql', { line: 10, indent: '' }))
      .toEqual({ ok: false, error: 'Unclosed #{ on line 11' });
    expect(formatCode('\n\n{"a": "x}', 'json')).toEqual({ ok: false, error: 'Unclosed string on line 3' });
  });

  test('a selection keeps the indentation of the line it starts on', () => {
    expect(formatCode('select a from t', 'sql', { line: 3, indent: '    ' }))
      .toEqual({ ok: true, text: 'SELECT\n      a\n    FROM\n      t' });
    // Blank lines between statements stay blank.
    expect(formatCode('select 1; select 2', 'sql', { line: 1, indent: '  ' }))
      .toEqual({ ok: true, text: 'SELECT\n    1;\n\n  SELECT\n    2' });
  });

  test('text that happens to contain the token prefix is still restored', () => {
    const out = sql('select __belzph0__, #{a} from t');
    expect(out).toContain('__belzph0__');
    expect(out).toContain('#{a}');
  });
});

describe('formatCode: JSON', () => {
  test('lays out like JSON.stringify(value, null, 2)', () => {
    const text = '{"a":1,"b":[true,null,{"c":"x"}],"d":{},"e":[]}';
    expect(json(text)).toBe(JSON.stringify(JSON.parse(text), null, 2));
  });

  test('bare #{ } values are kept as they are', () => {
    expect(json('{"a": #{x}, "b": [#{list.element}, 2], "c": #{ m["k"] }}')).toBe(
      '{\n  "a": #{x},\n  "b": [\n    #{list.element},\n    2\n  ],\n  "c": #{ m["k"] }\n}'
    );
  });

  test('placeholders inside strings stay part of the string', () => {
    expect(json('{"q":"id = #{id} and x = \'#{y}\'","n":"#{a.b}"}')).toBe(
      '{\n  "q": "id = #{id} and x = \'#{y}\'",\n  "n": "#{a.b}"\n}'
    );
  });

  test('a placeholder inside a string may hold double quotes', () => {
    expect(json('{"a": "#{f("x")}", "b": ["pre #{m["k"]} post"]}')).toBe(
      '{\n  "a": "#{f("x")}",\n  "b": [\n    "pre #{m["k"]} post"\n  ]\n}'
    );
    // Valid JSON is read as plain JSON first, even when a string holds `#{`.
    expect(json('{"a": "#{x", "b": "}"}')).toBe('{\n  "a": "#{x",\n  "b": "}"\n}');
  });

  test('literals are copied, not re-serialised: big numbers and escapes survive', () => {
    const out = json('{"id":12345678901234567890,"f":1.50,"s":"a\\/b\\u00e9"}');
    expect(out).toBe('{\n  "id": 12345678901234567890,\n  "f": 1.50,\n  "s": "a\\/b\\u00e9"\n}');
  });

  test('formatted text comes back identical', () => {
    const once = json('{"a":[1,{"b":#{x}}]}');
    expect(json(once)).toBe(once);
  });

  test('invalid JSON is an error', () => {
    const result = formatCode('{"a": 1,, }', 'json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toStartWith('Invalid JSON');
  });

  test('an unclosed string or placeholder is an error', () => {
    expect(formatCode('{"a": "x}', 'json')).toEqual({ ok: false, error: 'Unclosed string on line 1' });
    expect(formatCode('{"a":\n #{x', 'json')).toEqual({ ok: false, error: 'Unclosed #{ on line 2' });
  });
});

describe('mapPosition', () => {
  test('keeps the cursor after the same token', () => {
    const before = 'select a from t';
    const after = 'SELECT\n  a\nFROM\n  t';
    expect(after.slice(0, mapPosition(before, before.indexOf('a') + 1, after))).toBe('SELECT\n  a');
    expect(mapPosition(before, 0, after)).toBe(0);
    expect(mapPosition(before, before.length, after)).toBe(after.length);
  });
});
