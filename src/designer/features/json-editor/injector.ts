import { T, FONT_MONO, RADIUS } from '../../ui/theme';
import { AD_INPUTS } from '../../../config/selectors';
import { EXTENSION_OWNED_ATTR, ns } from '../../../config/namespace';
import { createLogger } from '../../../shared/logger';

const log = createLogger('json-editor');

export const JSON_BUTTON_ID = ns('JSONButton');

/** The inline styles of an Inputs heading before the button was added to it. */
type HeadingStyle = Pick<CSSStyleDeclaration, 'display' | 'alignItems' | 'justifyContent'>;

/** Headings whose inline style injectJSONButton changed, with what they had before. */
export type StyledHeadings = Map<HTMLElement, HeadingStyle>;

/** Put back the inline styles injectJSONButton changed, and forget them. */
export function restoreHeadings(styled: StyledHeadings): void {
  for (const [el, previous] of styled) Object.assign(el.style, previous);
  styled.clear();
}

/** The text of an Inputs heading: "Inputs", "Input", "2 Inputs". */
const HEADING_TEXT = /^\d*\s*Inputs?$/i;
/** Text nodes the heading search looks at before it gives up. */
const MAX_TEXT_NODES = 20_000;
/** Candidate elements (per selector) the fallback looks at before it gives up. */
const MAX_CANDIDATES = 500;

/** True for the extension's own markup, which is never the page's heading. */
const isOwn = (el: Element): boolean => el.closest(`[${EXTENSION_OWNED_ATTR}]`) !== null;

// Button injection
export function findInputsSection(): HTMLElement | null {
  try {
    // Strategy 1: a text node that is exactly "Inputs" / "2 Inputs", in a
    // leaf element. Bounded, so a page without one costs a fixed amount.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let visited = 0;
    for (let node = walker.nextNode(); node && visited < MAX_TEXT_NODES; node = walker.nextNode()) {
      visited++;
      if (!HEADING_TEXT.test(node.textContent?.trim() || '')) continue;
      const el = node.parentElement;
      if (el && el.children.length === 0 && !isOwn(el)) {
        log.debug('Found inputs section via text match');
        return el.parentElement;
      }
    }

    // Strategy 2: an element named like an inputs section whose whole text is
    // the heading. A section merely mentioning "input" somewhere inside it is
    // not enough: the button would land on an unrelated element.
    for (const selector of AD_INPUTS.sectionCandidates) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      const count = Math.min(elements.length, MAX_CANDIDATES);
      for (let i = 0; i < count; i++) {
        const el = elements[i]!;
        if (!isOwn(el) && HEADING_TEXT.test(el.textContent?.trim() ?? '')) {
          log.debug('Found inputs section via selector match');
          return el;
        }
      }
    }

    log.debug('Inputs section not found');
    return null;
  } catch (error) {
    log.error('Error finding inputs section:', error);
    return null;
  }
}

/** The JSON button; `onClick` opens the editor. */
export function createJSONButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/>' +
    '<path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>' +
    '</svg><span>JSON</span>';
  button.setAttribute('title', 'Edit inputs as JSON');
  button.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  button.id = JSON_BUTTON_ID;

  Object.assign(button.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    background: T.ink,
    color: T.fg,
    border: `1px solid ${T.line2}`,
    borderRadius: RADIUS,
    fontFamily: FONT_MONO,
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    marginLeft: '12px',
    transition: 'background 140ms ease, border-color 140ms ease'
  });

  button.addEventListener('mouseenter', () => {
    button.style.background = T.surface2;
    button.style.borderColor = T.accent;
  });

  button.addEventListener('mouseleave', () => {
    button.style.background = T.ink;
    button.style.borderColor = T.line2;
  });

  button.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    log.debug('JSON button clicked');
    onClick();
  };

  return button;
}

/**
 * Put `button` next to the Inputs heading, unless it is already on the page.
 * A heading whose inline style is changed to hold the button is recorded in
 * `styled`, so the caller can put it back (restoreHeadings) when it stops.
 */
export function injectJSONButton(button: HTMLButtonElement, styled?: StyledHeadings): boolean {
  try {
    // Don't inject if already present
    if (button.isConnected || document.getElementById(JSON_BUTTON_ID)) {
      log.debug('JSON button already injected');
      return true;
    }

    const section = findInputsSection();

    if (!section) {
      log.debug('Inputs section not found for button injection');
      return false;
    }

    // Try to find the title element (containing "Inputs" text)
    let titleElement: HTMLElement | null = null;

    // Look for direct text node parent
    for (const child of section.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && /Inputs?/i.test(child.textContent ?? '')) {
        titleElement = section;
        break;
      }
      if (child.nodeType === Node.ELEMENT_NODE && /^\d*\s*Inputs?$/i.test(child.textContent?.trim() ?? '')) {
        titleElement = child as HTMLElement;
        break;
      }
    }

    if (!titleElement) {
      titleElement = section;
    }

    // Ensure the container can hold the button
    if (titleElement.style.display !== 'flex') {
      if (styled) {
        // Headings the app has since re-rendered away need no restoring.
        for (const el of styled.keys()) if (!el.isConnected) styled.delete(el);
        if (!styled.has(titleElement)) {
          const { display, alignItems, justifyContent } = titleElement.style;
          styled.set(titleElement, { display, alignItems, justifyContent });
        }
      }
      Object.assign(titleElement.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      });
    }

    titleElement.appendChild(button);

    log.debug('JSON button successfully injected');
    return true;
  } catch (error) {
    log.error('Error injecting JSON button:', error);
    return false;
  }
}
