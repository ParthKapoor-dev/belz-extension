// Which `#{variables}` exist on an Automation Designer method, and which of
// them a given step can see — read from the live page, so unsaved draft edits
// (a step added a moment ago) count. No API call, no auth.
//
// Called once each time the IDE opens (see Ide's scope
// provider), never per keystroke and never from an observer: two
// querySelectorAll calls over the page, one per group.
//
// AD-only: ad-content.ts hands scanScope to Ide. pd-content.ts does
// not, so the PD bundle never contains this module.

import { AD_SCOPE } from '../../../config/selectors';
import { createLogger } from '../../../shared/logger';
import type { ScopeVariable, VariableScope } from '../ide/scope';

const log = createLogger('ad-scope');

/** The 0-based index of the step holding `el`, or null outside any step. */
export function stepIndexOf(el: Element): number | null {
  const step = el.closest(AD_SCOPE.step);
  if (!step) return null;
  const index = Number.parseInt(step.id.slice(AD_SCOPE.stepIdPrefix.length), 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** The name in a "Field Code: #{name}" text, or null. */
export function fieldCodeName(text: string | null): string | null {
  const match = AD_SCOPE.fieldCodeText.exec(text ?? '');
  const name = match?.[1]?.trim();
  return name ? name : null;
}

/**
 * Every variable the method declares, as seen from `textarea`: inputs and
 * internal variables always in scope; step outputs in scope only when their
 * step runs before the edited one. Outside any step, everything is in scope.
 *
 * A name is listed once. An output written into a declared variable stays the
 * declared variable; an output produced by several steps keeps the earliest.
 */
export function scanScope(root: ParentNode, textarea: Element): VariableScope {
  const current = stepIndexOf(textarea);
  const byName = new Map<string, ScopeVariable>();

  for (const el of root.querySelectorAll(AD_SCOPE.declaredFieldCodes)) {
    const name = fieldCodeName(el.textContent);
    if (!name || byName.has(name)) continue;
    const kind = el.closest(AD_SCOPE.internalList) ? 'variable' : 'input';
    byName.set(name, { name, kind, inScope: true });
  }

  const outputs: ScopeVariable[] = [];
  for (const el of root.querySelectorAll(AD_SCOPE.stepOutputFieldCodes)) {
    const name = fieldCodeName(el.textContent);
    const step = name ? stepIndexOf(el) : null;
    if (!name || step === null) continue;
    outputs.push({ name, kind: 'output', step, inScope: current === null || step < current });
  }
  outputs.sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  for (const output of outputs) {
    if (!byName.has(output.name)) byName.set(output.name, output);
  }

  const variables = [...byName.values()];
  log.debug(`scope at step ${current ?? '-'}: ${variables.length} variables`);
  return { step: current, variables };
}
