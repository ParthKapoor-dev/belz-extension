// `#{variable}` intellisense for the large editor: completion, hover and lint
// over a VariableScope read once when the editor opened.
//
// Part of the lazily loaded editor chunk (imported by modal.ts only). The scope
// is plain data: the editor never reads the page itself (see scope.ts).

import { EditorView, hoverTooltip } from '@codemirror/view';
import { linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { T, FONT_MONO, RADIUS } from '../../ui/theme';
import { ns } from '../../../config/namespace';
import {
  EXPRESSION_LOOKBACK,
  describeVariable,
  isInsideExpression,
  lintReferences,
  referenceAt,
  variablesByName
} from './references';
import type { ScopeVariable, VariableScope } from './scope';

const HOVER_CLASS = ns('VariableHover');
const HOVER_KIND_CLASS = ns('VariableHoverKind');

/** How far past the hovered position a reference can still extend. */
const HOVER_LOOKAHEAD = 200;

/** Declared names first, then earlier outputs; outputs not produced yet last. */
function boostOf(variable: ScopeVariable): number {
  if (!variable.inScope) return -50;
  return variable.kind === 'input' ? 3 : variable.kind === 'variable' ? 2 : 1;
}

/**
 * Completes variable names after `#{`, and bare names anywhere inside an open
 * `#{ … ` (SpEL such as `#{a == null or a.size()}` names them without `#`).
 * After `#{name.` it offers `element`, the item of a step looping over `name`:
 * which step loops over what is not visible on the page, so it is offered for
 * any known name.
 */
export function variableCompletionSource(scope: VariableScope): CompletionSource {
  const known = variablesByName(scope);

  return (context: CompletionContext): CompletionResult | null => {
    let from: number;
    let typed: string;
    let braced = false;

    const afterBrace = context.matchBefore(/#\{[\w.]*/);
    if (afterBrace) {
      braced = true;
      from = afterBrace.from + 2;
      typed = afterBrace.text.slice(2);
    } else {
      const word = context.matchBefore(/[A-Za-z_][\w.]*/);
      if (!word) return null;
      if (context.state.sliceDoc(word.from - 1, word.from) === '.') return null;
      const before = context.state.sliceDoc(Math.max(0, word.from - EXPRESSION_LOOKBACK), word.from);
      if (!isInsideExpression(before)) return null;
      from = word.from;
      typed = word.text;
    }

    // With closeBrackets, typing `#{` already produced the `}`.
    const close = braced && context.state.sliceDoc(context.pos, context.pos + 1) !== '}' ? '}' : '';

    const dot = typed.lastIndexOf('.');
    if (dot !== -1) {
      const root = typed.slice(0, typed.indexOf('.'));
      if (!known.has(root)) return null;
      return {
        from: from + dot + 1,
        options: [{
          label: 'element',
          type: 'property',
          detail: 'loop item',
          info: `The current item, in a step that loops over ${root}`,
          apply: `element${close}`
        }],
        validFor: /^\w*$/
      };
    }

    const options: Completion[] = scope.variables.map((variable) => {
      const { detail, info } = describeVariable(variable);
      return {
        label: variable.name,
        type: 'variable',
        detail,
        info,
        boost: boostOf(variable),
        apply: `${variable.name}${close}`
      };
    });
    return { from, options, validFor: /^\w*$/ };
  };
}

const variablesTheme = EditorView.theme({
  '.cm-tooltip.cm-tooltip-hover, .cm-tooltip-lint': {
    fontFamily: FONT_MONO,
    fontSize: '12px',
    background: 'rgba(15, 23, 42, 0.96)',
    color: T.fg,
    border: '1px solid rgba(148, 163, 184, 0.3)',
    borderRadius: RADIUS
  },
  [`.${HOVER_CLASS}`]: {
    padding: '4px 8px'
  },
  [`.${HOVER_KIND_CLASS}`]: {
    color: T.fgMuted,
    marginLeft: '8px'
  }
});

/** Hover, lint and theme for `#{variables}`. Completion goes through the mode's own list. */
export function variableExtensions(scope: VariableScope): Extension[] {
  return [
    hoverTooltip((view, pos) => {
      const start = Math.max(0, pos - EXPRESSION_LOOKBACK);
      const text = view.state.sliceDoc(start, pos + HOVER_LOOKAHEAD);
      const ref = referenceAt(text, pos - start, scope);
      if (!ref) return null;
      return {
        pos: start + ref.from,
        end: start + ref.to,
        above: true,
        create: () => {
          const dom = document.createElement('div');
          dom.className = HOVER_CLASS;
          const name = document.createElement('strong');
          name.textContent = ref.variable.name;
          const kind = document.createElement('span');
          kind.className = HOVER_KIND_CLASS;
          kind.textContent = describeVariable(ref.variable).info;
          dom.append(name, kind);
          return { dom };
        }
      };
    }),
    linter((view) => lintReferences(view.state.doc.toString(), scope)),
    variablesTheme
  ];
}
