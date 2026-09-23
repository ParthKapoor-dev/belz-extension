// A minimal Automation Designer method page for the `#{variable}` scanner:
// the Inputs step (method inputs + internal variables) and a few steps with
// outputs, in the markup verified on a live AD page.

export interface StepFixture {
  outputs: string[];
}

/** "Field Code: #{name}" as the Inputs step renders it. */
const declared = (name: string, sep = ': ') =>
  `<div class="service-designer__grid-row"><div class="fieldCode">Field Code${sep}#{${name}}</div></div>`;

/** A step output, "Field Code : #{name}" (space before the colon). */
const output = (name: string, sep = ' : ') => `
  <div class="_input-value">
    <exp-input-label><input value="${name}"></exp-input-label>
    <div class="mt1 font-size-smallest">Field Code${sep}#{${name}}</div>
  </div>`;

const step = (index: number, outputs: string[]) => `
  <exp-sd-step-three id="step3_${index}">
    <span class="service-designer__step">3.${index + 1}</span>
    <exp-user-inputs><exp-user-input><exp-textarea>
      <textarea id="ta${index}"></textarea>
    </exp-textarea></exp-user-input></exp-user-inputs>
    <div class="outputs">${outputs.map((name) => output(name)).join('')}</div>
  </exp-sd-step-three>`;

export function renderAdScope(
  inputs: string[],
  internals: string[],
  steps: StepFixture[]
): void {
  document.body.innerHTML = `
    <exp-sd-step-two id="step2"><exp-sd-inputs>
      <div class="INPUT_LIST">${inputs.map((name) => declared(name)).join('')}</div>
      <div class="INTERNAL_LIST">${internals.map((name) => declared(name, ' :  ')).join('')}</div>
      <textarea id="taInputs"></textarea>
    </exp-sd-inputs></exp-sd-step-two>
    ${steps.map((s, i) => step(i, s.outputs)).join('')}
    <exp-sd-step-four><exp-sd-outputs><textarea id="taOutputs"></textarea></exp-sd-outputs></exp-sd-step-four>`;
}

export { output as renderStepOutput };
