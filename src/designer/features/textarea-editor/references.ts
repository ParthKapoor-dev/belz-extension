// `#{variable}` references in the large editor's text: where they are, what
// they point to, and which look wrong.
//
// Pure: no DOM, no CodeMirror. variables.ts wires these into the editor
// (completion, hover, lint); keeping them apart lets them be tested on plain
// strings.
//
// `#{ … }` holds full SpEL (`#{a == null or a.size() > 0}`, `T(java.lang.Math)`,
// `#this`, string literals), so the checks stay conservative: only the simple
// `#{name}` / `#{name.path}` forms are linted, and anything else is left alone.

import type { ScopeVariable, VariableScope } from './scope';

/** How far back to look for an open `#{` before the cursor. */
export const EXPRESSION_LOOKBACK = 2000;

/** Words a simple `#{word}` can hold without naming a variable. */
const SPEL_WORDS = new Set(['true', 'false', 'null', 'this', 'root', 'T', 'new']);

const SIMPLE_REFERENCE_RE = /^(\s*)([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*\s*$/;

/** The UI label of a 0-based step index: step 0 is "3.1". */
export function stepLabel(index: number): string {
  return `3.${index + 1}`;
}

/** What a variable is, short (completion detail) and long (completion info, hover). */
export function describeVariable(variable: ScopeVariable): { detail: string; info: string } {
  if (variable.kind === 'input') return { detail: 'input', info: 'Input' };
  if (variable.kind === 'variable') return { detail: 'variable', info: 'Internal variable' };
  const step = stepLabel(variable.step ?? 0);
  return variable.inScope
    ? { detail: `step ${step}`, info: `Output of step ${step}` }
    : { detail: `step ${step} (later)`, info: `Output of step ${step} (not produced yet at this step)` };
}

/** The editor footer's summary of a scope. */
export function scopeStatus(scope: VariableScope): string {
  const count = scope.variables.filter((v) => v.inScope).length;
  const where = scope.step === null ? 'Outside steps' : `Step ${stepLabel(scope.step)}`;
  return `${where} · ${count} variable${count === 1 ? '' : 's'} in scope`;
}

export function variablesByName(scope: VariableScope): Map<string, ScopeVariable> {
  return new Map(scope.variables.map((v) => [v.name, v]));
}

/** One `#{` and, when it is closed, the index just past its matching `}`. */
export interface Expression {
  from: number;
  to: number | null;
}

/** The index of the quote closing the literal opened at `start`, or -1. */
function closingQuote(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === quote) return i;
    if (text[i] === '\n') return -1;
  }
  return -1;
}

/**
 * Every `#{` in `text`, with the `}` that closes it. Braces inside the
 * expression nest (SpEL inline lists and maps), and braces inside a string
 * literal do not count.
 */
export function findExpressions(text: string): Expression[] {
  const found: Expression[] = [];
  let at = text.indexOf('#{');
  while (at !== -1) {
    let depth = 1;
    let end: number | null = null;
    for (let i = at + 2; i < text.length; i++) {
      const ch = text[i];
      if (ch === "'" || ch === '"') {
        const close = closingQuote(text, i);
        if (close !== -1) i = close;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    found.push({ from: at, to: end });
    at = text.indexOf('#{', end ?? at + 2);
  }
  return found;
}

/** Whether the end of `before` sits inside an open `#{ … `. */
export function isInsideExpression(before: string): boolean {
  const expressions = findExpressions(before);
  return expressions.length > 0 && expressions[expressions.length - 1]!.to === null;
}

/** A diagnostic in @codemirror/lint's shape, without depending on it. */
export interface ReferenceDiagnostic {
  from: number;
  to: number;
  severity: 'warning';
  message: string;
}

/**
 * Warnings for `text`: an unclosed `#{`, a simple reference to an unknown
 * name, and a reference to the output of a step that has not run yet.
 * Unknown names are reported only when the scope found any variables at all,
 * so a page whose markup could not be read produces no noise.
 */
export function lintReferences(text: string, scope: VariableScope): ReferenceDiagnostic[] {
  const known = variablesByName(scope);
  const diagnostics: ReferenceDiagnostic[] = [];
  for (const { from, to } of findExpressions(text)) {
    if (to === null) {
      diagnostics.push({ from, to: from + 2, severity: 'warning', message: 'Unclosed #{ — no matching }' });
      continue;
    }
    const match = SIMPLE_REFERENCE_RE.exec(text.slice(from + 2, to - 1));
    if (!match) continue;
    const name = match[2]!;
    if (SPEL_WORDS.has(name)) continue;
    const start = from + 2 + match[1]!.length;
    const range = { from: start, to: start + name.length, severity: 'warning' as const };
    const variable = known.get(name);
    if (!variable) {
      if (known.size > 0) diagnostics.push({ ...range, message: `Unknown variable '${name}'` });
    } else if (!variable.inScope) {
      const at = scope.step === null ? '' : ` (this is step ${stepLabel(scope.step)})`;
      diagnostics.push({
        ...range,
        message: `'${name}' is the output of step ${stepLabel(variable.step ?? 0)}, which has not run yet${at}`
      });
    }
  }
  return diagnostics;
}

/** The known variable named at `pos` inside a `#{ … }`, with its range. */
export function referenceAt(
  text: string,
  pos: number,
  scope: VariableScope
): { from: number; to: number; variable: ScopeVariable } | null {
  let from = pos;
  let to = pos;
  while (from > 0 && /\w/.test(text[from - 1]!)) from--;
  while (to < text.length && /\w/.test(text[to]!)) to++;
  if (from === to || text[from - 1] === '.') return null;
  if (!isInsideExpression(text.slice(Math.max(0, from - EXPRESSION_LOOKBACK), from))) return null;
  const variable = variablesByName(scope).get(text.slice(from, to));
  return variable ? { from, to, variable } : null;
}
