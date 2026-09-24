// The IDE's Format action: pretty-prints SQL and JSON without touching
// Automation Designer's `#{ … }` placeholders or `:name` parameters.
//
// Pure: no DOM, no CodeMirror. Its own lazily loaded chunk: modal.ts reaches
// it only through `import('./format')`, on the first Format, so neither a
// page load nor opening the IDE pays for sql-formatter.
//
// Only the PostgreSQL dialect is imported (AD's database is PostgreSQL, and
// its queries use jsonb operators): `formatDialect` with one dialect lets the
// bundler drop every other one.

import { formatDialect, postgresql, type FormatOptionsWithDialect } from 'sql-formatter';
import { expressionEnd, findExpressions } from './references';
import type { FormattableMode } from './language';

/** How Format lays out SQL: keywords upper case, data types lower case, names as written. */
export const SQL_FORMAT_OPTIONS: FormatOptionsWithDialect = {
  dialect: postgresql,
  keywordCase: 'upper',
  dataTypeCase: 'lower',
  identifierCase: 'preserve',
  tabWidth: 2,
  linesBetweenQueries: 1,
  // `:name` is an AD parameter, `$1` a PostgreSQL one. Declared, they are kept
  // whole (`= :id`, never `=:id`), and `::type` casts stay casts.
  paramTypes: { named: [':'], numbered: ['$'] }
};

/**
 * The words a SQL statement can start with. Format refuses text that starts
 * with anything else: sql-formatter lays out almost any text without an
 * error, so this is the light check that it is SQL at all.
 */
const SQL_STATEMENT_WORDS = new Set([
  'ALTER', 'ANALYZE', 'BEGIN', 'CALL', 'CHECKPOINT', 'CLOSE', 'CLUSTER', 'COMMENT', 'COMMIT', 'COPY',
  'CREATE', 'DEALLOCATE', 'DECLARE', 'DELETE', 'DISCARD', 'DO', 'DROP', 'END', 'EXECUTE', 'EXPLAIN',
  'FETCH', 'GRANT', 'IMPORT', 'INSERT', 'LISTEN', 'LOCK', 'MERGE', 'MOVE', 'NOTIFY', 'PREPARE',
  'REFRESH', 'REINDEX', 'RELEASE', 'RESET', 'REVOKE', 'ROLLBACK', 'SAVEPOINT', 'SELECT', 'SET', 'SHOW',
  'START', 'TABLE', 'TRUNCATE', 'UNLISTEN', 'UPDATE', 'VACUUM', 'VALUES', 'WITH'
]);

/**
 * PostgreSQL's one-word data types. sql-formatter shows a data type followed
 * by `[` (`::text[]`) as a keyword, upper case whatever `dataTypeCase` says,
 * so Format lower-cases those itself (lowerArrayTypes()). `ARRAY` is the
 * `ARRAY[…]` constructor there, a keyword, and stays upper case.
 */
const ARRAY_DATA_TYPES = new Set(
  postgresql.tokenizerOptions.reservedDataTypes.filter((type) => !type.includes(' ') && type !== 'ARRAY')
);

/** Indentation of formatted JSON, as JSON.stringify(value, null, 2). */
const JSON_INDENT = '  ';

const PLACEHOLDER_LOST = 'A #{ } placeholder did not survive formatting';

export type FormatResult = { ok: true; text: string } | { ok: false; error: string };

/** Where the text to format sits in the document. */
export interface FormatPlace {
  /** The document line (1-based) the text starts on: errors name document lines. */
  line: number;
  /**
   * The indentation of that line, given to every formatted line after the
   * first, so a formatted selection keeps its place in the text around it.
   */
  indent: string;
}

/** The whole document: line 1, no indentation to keep. */
const WHOLE_TEXT: FormatPlace = { line: 1, indent: '' };

/** Formats `core`; `lineAt(index)` is the document line of an index in `core`. */
type Formatter = (core: string, lineAt: (index: number) => number) => FormatResult;

/** Number of line breaks in `text` before `index`. */
function breaksBefore(text: string, index: number): number {
  let breaks = 0;
  for (let i = 0; i < index; i++) if (text[i] === '\n') breaks++;
  return breaks;
}

/** Index in `text` where its line `line` (1-based) starts. */
function lineStart(text: string, line: number): number {
  let at = 0;
  for (let n = 1; n < line; n++) {
    const eol = text.indexOf('\n', at);
    if (eol === -1) break;
    at = eol + 1;
  }
  return at;
}

/** A token prefix that `text` does not contain, so every occurrence is ours. */
function freshPrefix(text: string): string {
  let prefix = '__belzph';
  while (text.includes(prefix)) prefix += 'x';
  return prefix;
}

/**
 * The first word of `sql`, upper case, past whitespace, opening parentheses,
 * comments and placeholder tokens (words starting with `prefix`); '' when
 * there is none, or the first other character when it is not a word.
 */
function firstWord(sql: string, prefix: string): string {
  let rest = sql;
  for (;;) {
    rest = rest.replace(/^[\s(]+/, '');
    if (rest.startsWith('--')) {
      const eol = rest.indexOf('\n');
      rest = eol === -1 ? '' : rest.slice(eol + 1);
    } else if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/');
      rest = end === -1 ? '' : rest.slice(end + 2);
    } else {
      const word = /^[A-Za-z_]\w*/.exec(rest)?.[0];
      if (!word) return rest.charAt(0);
      if (!word.startsWith(prefix)) return word.toUpperCase();
      rest = rest.slice(word.length);
    }
  }
}

/**
 * Where the SQL string literal, quoted name or comment starting at `i` ends;
 * null when none starts there: standard strings ('…', '' inside), E'…'
 * strings (backslash escapes), "names", $tag$ bodies $tag$, -- and /* comments.
 */
function literalEnd(sql: string, i: number): number | null {
  const ch = sql[i];
  if (ch === "'" || ch === '"') {
    const escapes = ch === "'" && /(^|\W)[Ee]$/.test(sql.slice(Math.max(0, i - 2), i));
    for (let j = i + 1; j < sql.length; j++) {
      if (escapes && sql[j] === '\\') j++;
      else if (sql[j] === ch && sql[j + 1] === ch) j++;
      else if (sql[j] === ch) return j + 1;
    }
    return sql.length;
  }
  if (sql.startsWith('--', i)) {
    const eol = sql.indexOf('\n', i);
    return eol === -1 ? sql.length : eol;
  }
  if (sql.startsWith('/*', i)) {
    const end = sql.indexOf('*/', i + 2);
    return end === -1 ? sql.length : end + 2;
  }
  const dollar = ch === '$' ? /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i))?.[0] : undefined;
  if (dollar) {
    const end = sql.indexOf(dollar, i + dollar.length);
    return end === -1 ? sql.length : end + dollar.length;
  }
  return null;
}

/**
 * `sql` with each data type that is followed by `[` lower case, outside
 * string literals, quoted names and comments (see ARRAY_DATA_TYPES).
 */
function lowerArrayTypes(sql: string): string {
  const fix = (code: string) =>
    code.replace(/(?<![.\w])[A-Za-z]+(?=\s*\[)/g, (word) =>
      ARRAY_DATA_TYPES.has(word.toUpperCase()) ? word.toLowerCase() : word
    );
  let out = '';
  let from = 0;
  for (let i = 0; i < sql.length; ) {
    const end = literalEnd(sql, i);
    if (end === null) {
      i++;
      continue;
    }
    out += fix(sql.slice(from, i)) + sql.slice(i, end);
    from = i = end;
  }
  return out + fix(sql.slice(from));
}

/**
 * SQL, with each `#{ … }` swapped for a plain identifier while sql-formatter
 * runs and swapped back afterwards. An identifier survives formatting verbatim
 * (only keywords change case), so the expression inside, spaces, quotes and
 * operators included, is never seen by the formatter. Each token must come
 * back exactly once, or nothing is changed. Text that does not start with a
 * statement word is refused: it is not SQL, however it would lay out.
 */
const formatSql: Formatter = (core, lineAt) => {
  const expressions = findExpressions(core);
  const unclosed = expressions.find((expression) => expression.to === null);
  if (unclosed) {
    return { ok: false, error: `Unclosed #{ on line ${lineAt(unclosed.from)}` };
  }

  const prefix = freshPrefix(core);
  const originals: string[] = [];
  /** Where each token starts in `masked`, and how much longer its original is. */
  const swaps: Array<{ at: number; grow: number }> = [];
  let masked = '';
  let last = 0;
  for (const { from, to } of expressions) {
    const token = `${prefix}${originals.length}__`;
    const original = core.slice(from, to!);
    originals.push(original);
    masked += core.slice(last, from);
    swaps.push({ at: masked.length, grow: original.length - token.length });
    masked += token;
    last = to!;
  }
  masked += core.slice(last);
  /** The document line of an index in `masked`. */
  const maskedLineAt = (index: number) =>
    lineAt(index + swaps.filter((swap) => swap.at < index).reduce((sum, swap) => sum + swap.grow, 0));

  const start = firstWord(masked, prefix);
  if (start && !SQL_STATEMENT_WORDS.has(start)) {
    return { ok: false, error: `Doesn't look like SQL: it starts with "${start}"` };
  }

  let formatted: string;
  try {
    formatted = formatDialect(masked, SQL_FORMAT_OPTIONS);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).split('\n')[0];
    // sql-formatter counts lines in the masked text; name the document's line.
    const located = message?.replace(
      /\s*at line (\d+) column \d+\.?$/,
      (_, line: string) => ` (line ${maskedLineAt(lineStart(masked, Number(line)))})`
    );
    return { ok: false, error: located || 'The SQL could not be parsed' };
  }

  if (formatted.split(prefix).length - 1 !== originals.length) return { ok: false, error: PLACEHOLDER_LOST };
  for (let i = 0; i < originals.length; i++) {
    const parts = formatted.split(`${prefix}${i}__`);
    if (parts.length !== 2) return { ok: false, error: PLACEHOLDER_LOST };
    formatted = parts.join(originals[i]!);
  }
  return { ok: true, text: lowerArrayTypes(formatted) };
};

type JsonToken =
  | { kind: 'punct'; text: '{' | '}' | '[' | ']' | ',' | ':' }
  /** `text` verbatim, and what JSON.parse checks in its place. */
  | { kind: 'value'; text: string; parseAs: string };

/**
 * JSON's tokens, each kept verbatim: strings, bare placeholders (`"a": #{x}`,
 * checked as `""`), punctuation, and literals (numbers, true, false, null).
 * A `#{ … }` inside a string is plain string text, unless
 * `placeholdersInStrings`: then a balanced one is part of the string whatever
 * it holds (quotes included: `"#{f("x")}"`), and JSON.parse checks the string
 * without it. When a string or placeholder is not closed, which one and where.
 */
function jsonTokens(text: string, placeholdersInStrings: boolean): JsonToken[] | { unclosed: string; at: number } {
  const tokens: JsonToken[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ',' || ch === ':') {
      tokens.push({ kind: 'punct', text: ch });
      i++;
    } else if (ch === '"') {
      let end = i + 1;
      let parseAs = '';
      let from = i;
      while (end < text.length && text[end] !== '"') {
        const close = placeholdersInStrings && text.startsWith('#{', end) ? expressionEnd(text, end) : null;
        if (close !== null) {
          parseAs += text.slice(from, end);
          end = from = close;
        } else {
          end += text[end] === '\\' ? 2 : 1;
        }
      }
      if (end >= text.length) return { unclosed: 'string', at: i };
      tokens.push({ kind: 'value', text: text.slice(i, end + 1), parseAs: parseAs + text.slice(from, end + 1) });
      i = end + 1;
    } else if (ch === '#' && text[i + 1] === '{') {
      const end = expressionEnd(text, i);
      if (end === null) return { unclosed: '#{', at: i };
      tokens.push({ kind: 'value', text: text.slice(i, end), parseAs: '""' });
      i = end;
    } else {
      let end = i;
      while (end < text.length && !/[\s{}[\],:"]/.test(text[end]!) && !text.startsWith('#{', end)) end++;
      const literal = text.slice(i, end);
      tokens.push({ kind: 'value', text: literal, parseAs: literal });
      i = end;
    }
  }
  return tokens;
}

/** JSON's tokens when they make valid JSON, else why not. */
function validJsonTokens(core: string, lineAt: (index: number) => number, placeholdersInStrings: boolean): JsonToken[] | string {
  const tokens = jsonTokens(core, placeholdersInStrings);
  if (!Array.isArray(tokens)) return `Unclosed ${tokens.unclosed} on line ${lineAt(tokens.at)}`;
  try {
    JSON.parse(tokens.map((token) => (token.kind === 'value' ? token.parseAs : token.text)).join(' '));
  } catch (error) {
    return `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  return tokens;
}

/**
 * JSON, laid out as JSON.stringify(value, null, 2) would, but from the
 * source's own tokens: numbers keep their digits (no precision lost on large
 * ids), duplicate keys stay, strings keep their escapes. JSON.parse checks it
 * first, with each bare placeholder standing in as `""`, which is valid both
 * as a key and as a value. When that fails, it is checked once more with each
 * balanced `#{ … }` inside a string taken as part of that string, so a
 * placeholder whose expression holds double quotes does not break it; the
 * first check's error is the one reported.
 */
const formatJson: Formatter = (core, lineAt) => {
  const plain = validJsonTokens(core, lineAt, false);
  const tokens = Array.isArray(plain) ? plain : validJsonTokens(core, lineAt, true);
  if (!Array.isArray(tokens)) return { ok: false, error: plain as string };

  let out = '';
  let depth = 0;
  const newline = () => '\n' + JSON_INDENT.repeat(depth);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind === 'value') {
      out += token.text;
    } else if (token.text === '{' || token.text === '[') {
      const next = tokens[i + 1];
      if (next?.kind === 'punct' && (next.text === '}' || next.text === ']')) {
        out += token.text + next.text;
        i++;
      } else {
        depth++;
        out += token.text + newline();
      }
    } else if (token.text === '}' || token.text === ']') {
      depth--;
      out += newline() + token.text;
    } else if (token.text === ',') {
      out += ',' + newline();
    } else {
      out += ': ';
    }
  }
  return { ok: true, text: out };
};

/**
 * `text` formatted as `mode`, with the whitespace before and after it kept,
 * and every formatted line after the first indented by `place.indent`. On an
 * error `text` is not to be changed; the error says why, naming document
 * lines (`place.line` is the line `text` starts on).
 */
export function formatCode(text: string, mode: FormattableMode, place: FormatPlace = WHOLE_TEXT): FormatResult {
  const core = text.trim();
  if (!core) return { ok: true, text };
  const start = text.indexOf(core);
  const lineAt = (index: number) => place.line + breaksBefore(text, start + index);
  const result = (mode === 'sql' ? formatSql : formatJson)(core, lineAt);
  if (!result.ok) return result;
  const indented = place.indent ? result.text.replace(/\n(?=[^\n])/g, `\n${place.indent}`) : result.text;
  return { ok: true, text: text.slice(0, start) + indented + text.slice(start + core.length) };
}

/**
 * Where `pos` in `before` lands in `after`, when `after` is `before` with only
 * its whitespace or letter case changed: after the same number of
 * non-whitespace characters. Keeps the cursor on the same token across a
 * Format.
 */
export function mapPosition(before: string, pos: number, after: string): number {
  let count = 0;
  for (let i = 0; i < pos && i < before.length; i++) if (!/\s/.test(before[i]!)) count++;
  if (count === 0) return 0;
  for (let i = 0; i < after.length; i++) {
    if (!/\s/.test(after[i]!) && --count === 0) return i + 1;
  }
  return after.length;
}
