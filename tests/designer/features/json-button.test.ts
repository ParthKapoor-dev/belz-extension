import { afterEach, describe, expect, test } from 'bun:test';
import {
  JSON_BUTTON_ID,
  createJSONButton,
  findInputsSection,
  injectJSONButton,
  restoreHeadings,
  type StyledHeadings
} from '../../../src/designer/features/json-editor/injector';
import { EXTENSION_OWNED_ATTR } from '../../../src/config/namespace';

// The JSON button next to the Inputs heading: marked as extension-owned, and
// the heading's inline style it changes is put back by restoreHeadings (what
// JsonEditor.stop() calls). Assertions read plain values only.

afterEach(() => {
  document.body.innerHTML = '';
});

describe('JSON button injection', () => {
  test('marks the button, restyles the heading, and restores it', () => {
    document.body.innerHTML = '<section><span id="h" style="display: block">2 Inputs</span></section>';
    const heading = document.getElementById('h')!;
    const styled: StyledHeadings = new Map();
    const button = createJSONButton(() => {});

    expect(injectJSONButton(button, styled)).toBe(true);
    expect(button.hasAttribute(EXTENSION_OWNED_ATTR)).toBe(true);
    expect(button.parentElement === heading).toBe(true);
    expect(heading.style.display).toBe('flex');
    expect(styled.size).toBe(1);

    // A second pass (the page observer) neither re-adds nor re-records.
    expect(injectJSONButton(button, styled)).toBe(true);
    expect(document.querySelectorAll(`#${JSON_BUTTON_ID}`).length).toBe(1);

    button.remove();
    restoreHeadings(styled);
    expect([heading.style.display, heading.style.alignItems, heading.style.justifyContent]).toEqual(['block', '', '']);
    expect(styled.size).toBe(0);
  });

  test('a heading the app re-rendered away is forgotten, not restored', () => {
    document.body.innerHTML = '<section><span>Inputs</span></section>';
    const styled: StyledHeadings = new Map();
    injectJSONButton(createJSONButton(() => {}), styled);
    document.body.innerHTML = '<section><span>Inputs</span></section>';
    injectJSONButton(createJSONButton(() => {}), styled);
    expect(styled.size).toBe(1);
    restoreHeadings(styled);
  });
});

describe('finding the Inputs heading', () => {
  test('a section that only mentions inputs somewhere inside gets no button', () => {
    document.body.innerHTML =
      '<div class="input-panel"><p>Configure the inputs of this step below.</p><input></div>';
    expect(findInputsSection() === null).toBe(true);
    expect(injectJSONButton(createJSONButton(() => {}))).toBe(false);
  });

  test('an element named like an inputs section whose text is the heading is used', () => {
    document.body.innerHTML = '<div class="inputs-title"><b>Inputs</b><i></i></div>';
    expect(findInputsSection()?.className).toBe('inputs-title');
  });

  test('the extension\'s own markup is never taken for the heading', () => {
    document.body.innerHTML = `<div ${EXTENSION_OWNED_ATTR}="true"><span>Inputs</span></div>`;
    expect(findInputsSection() === null).toBe(true);
  });
});
