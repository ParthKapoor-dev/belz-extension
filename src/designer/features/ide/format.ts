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

/** How Format lays out SQL. */
export const SQL_FORMAT_OPTIONS: FormatOptionsWithDialect = {
  dialect: postgresql,
  keywordCase: 'upper',
  tabWidth: 2,
  linesBetweenQueries: 1,
  // `:name` is an AD parameter, `$1` a PostgreSQL one. Declared, they are kept
  // whole (`= :id`, never `=:id`), and `::type` casts stay casts.
  paramTypes: { named: [':'], numbered: ['$'] }
};

/** Indentation of formatted JSON, as JSON.stringify(value, null, 2). */
const JSON_INDENT = '  ';

export type FormatResult = { ok: true; text: string } | { ok: false; error: string };

/** Line (1-based) of `index` in `text`, for error messages. */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

/** Formats `core` (already trimmed) and puts back the whitespace around it. */
function keepingEdges(text: string, format: (core: string) => FormatResult): FormatResult {
  const core = text.trim();
  if (!core) return { ok: true, text };
  const start = text.indexOf(core);
  const result = format(core);
  if (!result.ok) return result;
  return { ok: true, text: text.slice(0, start) + result.text + text.slice(start + core.length) };
}

/** A token prefix that `text` does not contain, so every occurrence is ours. */
function freshPrefix(text: string): string {
  let prefix = '__belzph';
  while (text.includes(prefix)) prefix += 'x';
  return prefix;
}

/**
 * SQL, with each `#{ … }` swapped for a plain identifier while sql-formatter
 * runs and swapped back afterwards. An identifier survives formatting verbatim
 * (only keywords change case), so the expression inside, spaces, quotes and
 * operators included, is never seen by the formatter. Each token must come
 * back exactly once, or nothing is changed.
 */
function formatSql(core: string): FormatResult {
  const expressions = findExpressions(core);
  const unclosed = expressions.find((expression) => expression.to === null);
  if (unclosed) {
    return { ok: false, error: `Unclosed #{ on line ${lineOf(core, unclosed.from)}` };
  }

  const prefix = freshPrefix(core);
  const originals: string[] = [];
  let masked = '';
  let last = 0;
  for (const { from, to } of expressions) {
    const token = `${prefix}${originals.length}__`;
    originals.push(core.slice(from, to!));
    masked += core.slice(last, from) + token;
    last = to!;
  }
  masked += core.slice(last);

  let formatted: string;
  try {
    formatted = formatDialect(masked, SQL_FORMAT_OPTIONS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.split('\n')[0] || 'The SQL could not be parsed' };
  }

  if (formatted.split(prefix).length - 1 !== originals.length) {
    return { ok: false, error: 'A #{ } placeholder did not survive formatting' };
  }
  for (let i = 0; i < originals.length; i++) {
    const parts = formatted.split(`${prefix}${i}__`);
    if (parts.length !== 2) return { ok: false, error: 'A #{ } placeholder did not survive formatting' };
    formatted = parts.join(originals[i]!);
  }
  return { ok: true, text: formatted };
}

type JsonToken =
  | { kind: 'punct'; text: '{' | '}' | '[' | ']' | ',' | ':' }
  | { kind: 'value'; text: string; placeholder: boolean };

/**
 * JSON's tokens, each kept verbatim: strings (a `#{ … }` inside one is just
 * string text), bare placeholders (`"a": #{x}`), punctuation, and literals
 * (numbers, true, false, null). When a string or placeholder is not closed,
 * which one and where.
 */
function jsonTokens(text: string): JsonToken[] | { unclosed: string; at: number } {
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
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      if (end >= text.length) return { unclosed: 'string', at: i };
      tokens.push({ kind: 'value', text: text.slice(i, end + 1), placeholder: false });
      i = end + 1;
    } else if (ch === '#' && text[i + 1] === '{') {
      const end = expressionEnd(text, i);
      if (end === null) return { unclosed: '#{', at: i };
      tokens.push({ kind: 'value', text: text.slice(i, end), placeholder: true });
      i = end;
    } else {
      let end = i;
      while (end < text.length && !/[\s{}[\],:"]/.test(text[end]!) && !(text[end] === '#' && text[end + 1] === '{')) end++;
      tokens.push({ kind: 'value', text: text.slice(i, end), placeholder: false });
      i = end;
    }
  }
  return tokens;
}

/**
 * JSON, laid out as JSON.stringify(value, null, 2) would, but from the
 * source's own tokens: numbers keep their digits (no precision lost on large
 * ids), duplicate keys stay, strings keep their escapes. JSON.parse checks it
 * first, with each bare placeholder standing in as `""`, which is valid both
 * as a key and as a value.
 */
function formatJson(core: string): FormatResult {
  const tokens = jsonTokens(core);
  if (!Array.isArray(tokens)) {
    return { ok: false, error: `Unclosed ${tokens.unclosed} on line ${lineOf(core, tokens.at)}` };
  }
  try {
    JSON.parse(tokens.map((token) => (token.kind === 'value' && token.placeholder ? '""' : token.text)).join(' '));
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }

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
}

/**
 * `text` formatted as `mode`, with the whitespace before and after it kept.
 * On an error `text` is not to be changed; the error says why.
 */
export function formatCode(text: string, mode: FormattableMode): FormatResult {
  return keepingEdges(text, mode === 'sql' ? formatSql : formatJson);
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
