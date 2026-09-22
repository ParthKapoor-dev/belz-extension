// A minimal copy of the Automation Designer "Inputs" step markup — only the
// structure the extractor and sync engine read: the INPUT_LIST_<key> id, the
// grid row around it, the type / name / mandatory cells, and the test-value
// row holding the control.

export interface InputSpec {
  key: string;
  type: string; // as the page shows it, e.g. "Text", "Structured Data"
  name?: string;
  mandatory?: boolean;
  /** The test-value control's current value. */
  value?: string;
}

function control(spec: InputSpec): string {
  const value = spec.value ?? '';
  switch (spec.type) {
    case 'Boolean':
      return `<div class="boolean_response"><exp-select>
        <div class="ui-select-container" data-testid="select-option-wrapper-container">
          <span class="ui-select-match-text">${value}</span>
        </div>
        <ul class="options" hidden>
          <li><a><span class="select-option-text">Yes</span></a></li>
          <li><a><span class="select-option-text">No</span></a></li>
        </ul>
      </exp-select></div>`;
    case 'Number':
    case 'Integer':
      return `<input type="number" value="${value}">`;
    case 'File':
      return `<input type="file">`;
    default:
      return `<textarea>${value}</textarea>`;
  }
}

export function inputRow(spec: InputSpec): string {
  return `
  <div class="service-designer__grid-row">
    <div class="service-designer__grid-cell">
      <input placeholder="Enter Here" value="${spec.name ?? ''}">
      <span id="INPUT_LIST_${spec.key}"></span>${spec.mandatory ? '<span class="required">*</span>' : ''}
    </div>
    <div class="service-designer__grid-cell _type"><div class="type_name">${spec.type}</div></div>
    <div class="service-designer__grid-cell _mandatory">${spec.mandatory ? 'Yes' : 'No'}</div>
    <div class="service-designer__grid-row _test-case-row">${control(spec)}</div>
  </div>`;
}

/** Replace the page body with an Inputs step holding these inputs. */
export function renderInputs(specs: InputSpec[]): void {
  document.body.innerHTML = `<div class="inputs"><div><span>${specs.length} Inputs</span></div>${specs
    .map(inputRow)
    .join('')}</div>`;

  // The real exp-select opens its option list on click. Mimic that, and commit
  // the clicked option into the match text the way the widget does.
  for (const select of document.querySelectorAll('exp-select')) {
    const list = select.querySelector('ul.options') as HTMLElement;
    select.querySelector('.ui-select-container')!.addEventListener('click', () => {
      list.hidden = false;
    });
    for (const option of select.querySelectorAll('a')) {
      option.addEventListener('click', () => {
        select.querySelector('.ui-select-match-text')!.textContent = option.textContent!.trim();
        list.hidden = true;
      });
    }
  }
}
