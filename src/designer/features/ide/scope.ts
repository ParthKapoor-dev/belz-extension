// The variables the IDE knows about while it edits one textarea: the
// contract between the IDE and whatever reads them off the page.
//
// Types only. The IDE never looks for variables itself: an optional
// ScopeProvider is passed to Ide, and only ad-content.ts passes one
// (designer/features/ad-scope), so the PD bundle carries no scanner.

/** Where a variable comes from. */
export type ScopeKind = 'input' | 'variable' | 'output';

export interface ScopeVariable {
  name: string;
  kind: ScopeKind;
  /** The 0-based index of the step that produces it (outputs only). */
  step?: number;
  /** False for the output of the edited step or a later one: not produced yet. */
  inScope: boolean;
}

export interface VariableScope {
  /** The 0-based index of the step holding the edited textarea; null outside any step. */
  step: number | null;
  variables: ScopeVariable[];
}

/** Reads the variables in scope at `textarea`. Called once per IDE open. */
export type ScopeProvider = (textarea: HTMLTextAreaElement) => VariableScope;
