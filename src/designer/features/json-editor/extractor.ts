import { state } from '../../core/state';
import { normalizeDataType, type DataType, type ExtractedInput } from './types';
import { AD_INPUTS, AD_WIDGETS } from '../../../config/selectors';
import { TIMINGS } from '../../../config/timings';
import { firstMatch } from '../../utils/dom';
import { createLogger } from '../../../shared/logger';

const log = createLogger('json-editor');

/** An input key and the element that carries it. */
interface KeyElement {
  key: string;
  element: Element;
}

// Input extraction logic

// ===== Step 1: Key Detection =====
export function findAllInputKeys(): KeyElement[] {
  try {
    const keys: KeyElement[] = [];
    const seenKeys = new Set<string>();

    const collectKeys = (elements: Iterable<Element>) => {
      for (const el of elements) {
        const id = el.id;
        if (!id) continue;

        let key: string | null = null;

        if (id.startsWith(AD_INPUTS.keyIdPrefix)) {
          key = id.substring(AD_INPUTS.keyIdPrefix.length);
        } else {
          const fallbackMatch = id.match(AD_INPUTS.numberedKeyId);
          if (fallbackMatch) {
            key = fallbackMatch[1] ?? null;
          }
        }

        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        keys.push({ key, element: el });
        log.debug('Found input key:', key);
      }
    };

    // Primary selector used by current implementation.
    collectKeys(document.querySelectorAll(AD_INPUTS.keyElements));

    // Fallback for pages that only expose numeric INPUT_LIST ids.
    if (keys.length === 0) {
      collectKeys(document.querySelectorAll(AD_INPUTS.numberedKeyElements));
    }

    // Published page fallback: no INPUT_LIST ids — keys live in .fieldCode spans
    if (keys.length === 0) {
      const fieldCodeDivs = document.querySelectorAll(AD_INPUTS.publishedFieldCode);
      for (const div of fieldCodeDivs) {
        const spans = Array.from(div.querySelectorAll('span'));
        let key: string | null = null;
        let foundHash = false;
        for (const span of spans) {
          const text = span.textContent?.trim();
          if (!text) continue;
          if (text === '#{') { foundHash = true; continue; }
          if (foundHash && text !== '}') { key = text; break; }
        }
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        keys.push({ key, element: div });
        log.debug('Found input key (published page):', key);
      }
    }

    log.debug(`Total input keys found: ${keys.length}`);
    return keys;
  } catch (error) {
    log.error('Error finding input keys:', error);
    return [];
  }
}

// ===== Step 2: Container Identification =====
export function findInputContainer(element: Element): HTMLElement | null {
  try {
    let current: Element | null = element;
    let depth = 0;
    const maxDepth = 15;

    while (current && depth < maxDepth) {
      if (current.matches(AD_INPUTS.row)) {
        log.debug('Found container at depth:', depth);
        return current as HTMLElement;
      }
      current = current.parentElement;
      depth++;
    }

    log.debug('Container not found within max depth');
    return null;
  } catch (error) {
    log.error('Error finding container:', error);
    return null;
  }
}

// ===== Step 3: Data Type Extraction =====
export function extractDataType(container: Element): DataType {
  try {
    // The type lives in the row's dedicated `_type` cell. Query it directly so
    // the cells of a nested `_test-case-row` can never shadow the real one
    // (querying `.service-designer__grid-cell` unscoped picked those up too).
    const typeCell =
      container.querySelector(`:scope > ${AD_INPUTS.typeCell}`) ||
      container.querySelector(AD_INPUTS.typeCell);

    if (!typeCell) {
      log.debug('Type cell not found, defaulting to Text');
      return 'Text';
    }

    // Draft mode: type is an editable select.
    const selectText = typeCell.querySelector(AD_INPUTS.typeSelectText)?.textContent?.trim();
    if (selectText) return normalizeDataType(selectText);

    // Newer UI: a `.type_name` div.
    const typeName = typeCell.querySelector(AD_INPUTS.typeName)?.textContent?.trim();
    if (typeName) return normalizeDataType(typeName);

    // Published mode: the cell is plain text (e.g. "Date", "Structured Data").
    const text = typeCell.textContent?.trim();
    if (text && text.length < 40) {
      return normalizeDataType(text);
    }

    log.debug('Type text empty, defaulting to Text');
    return 'Text';
  } catch (error) {
    log.error('Error extracting data type:', error);
    return 'Text';
  }
}

// ===== Step 4: Test Value Element Detection =====
//
// Returns the semantic element for each type: the `exp-*` host for custom
// widgets (so the sync layer can drive the real UI) and the plain field for
// text-like types. The File input is returned even though it is hidden, so the
// sync layer can report it as "skipped" rather than silently dropping the key.
export function findTestValueElement(container: Element, type: DataType): HTMLElement | null {
  try {
    const testCaseRow = container.querySelector(AD_INPUTS.testCaseRow);
    if (!testCaseRow) {
      log.debug('Test case row not found (is Test Mode on?)');
      return null;
    }

    const element = firstMatch(testCaseRow, testValueSelectors(type));

    if (!element) {
      log.debug(`Test value element not found for type: ${type}`);
      return null;
    }

    log.debug(`Found test value <${element.tagName.toLowerCase()}> for type ${type}`);
    return element;
  } catch (error) {
    log.error('Error finding test value element:', error);
    return null;
  }
}

function testValueSelectors(type: DataType): readonly string[] {
  switch (type) {
    case 'Boolean':
    case 'Date':
    case 'DateTime':
    case 'File':
    case 'Number':
      return AD_INPUTS.testValue[type];
    case 'Integer':
      return AD_INPUTS.testValue.Number;
    default:
      return AD_INPUTS.testValue.Text;
  }
}

// ===== Step 5: Input Name Extraction =====
export function extractInputName(container: Element, key: string): string {
  try {
    const cells = container.querySelectorAll(AD_INPUTS.cell);
    
    if (cells.length < 1) {
      log.debug('No grid cells found for name extraction');
      return key;
    }

    const nameCell = cells[0]!; // 1st cell

    // Strategy 1: Find input with placeholder "Enter Here"
    const nameInput = nameCell.querySelector<HTMLInputElement>(AD_INPUTS.nameInput);
    if (nameInput && nameInput.value && nameInput.value.trim()) {
      log.debug('Found name from input:', nameInput.value);
      return nameInput.value.trim();
    }

    // Strategy 2: Extract from Field Code
    const fieldCodeMatch = container.textContent?.match(/Field Code:\s*#\{([^}]+)\}/);
    if (fieldCodeMatch && fieldCodeMatch[1]) {
      log.debug('Found name from field code:', fieldCodeMatch[1]);
      return fieldCodeMatch[1];
    }

    // Fallback: Use key
    log.debug('Using key as name:', key);
    return key;
  } catch (error) {
    log.error('Error extracting input name:', error);
    return key;
  }
}

// ===== Mandatory Detection =====
export function isMandatory(container: Element): boolean {
  try {
    // Look for mandatory indicators
    const text = container.textContent || '';
    
    // Check for asterisk or "Yes" in mandatory cell
    if (/\*|mandatory|required/i.test(text)) {
      const mandatoryCells = container.querySelectorAll(AD_INPUTS.mandatoryCell);
      if (mandatoryCells.length > 0) {
        const cellText = mandatoryCells[0]!.textContent?.trim().toLowerCase();
        return cellText === 'yes';
      }
      return true;
    }

    return false;
  } catch (error) {
    log.error('Error checking mandatory:', error);
    return false;
  }
}

// ===== Main Input Extraction with Caching =====
export function extractAllInputs(forceRefresh = false): ExtractedInput[] {
  try {
    // Reuse a recent scan.
    const now = Date.now();
    if (!forceRefresh && state.cachedInputs && (now - state.lastInputScanTime) < TIMINGS.inputScanCache) {
      log.debug('Using cached inputs');
      return state.cachedInputs;
    }

    log.debug('Starting input extraction...');
    const inputs: ExtractedInput[] = [];

    // Step 1: Find all input keys
    const keyElements = findAllInputKeys();

    if (keyElements.length === 0) {
      log.debug('No input keys found');
      state.cachedInputs = [];
      state.lastInputScanTime = now;
      return [];
    }

    // Process each input
    for (const { key, element } of keyElements) {
      try {
        // Step 2: Find container
        const container = findInputContainer(element);
        if (!container) {
          log.debug(`Container not found for key: ${key}`);
          continue;
        }

        // Step 3: Extract data type
        const type = extractDataType(container);

        // Check if this is structured data
        const isStructuredData = type === 'StructuredData';

        // Step 4: Find test value element
        const testValueElement = findTestValueElement(container, type);
        if (!testValueElement) {
          log.debug(`Test value element not found for key: ${key}`);
          continue;
        }

        // Step 5: Extract name
        const name = extractInputName(container, key);

        // Get current value - for structured data, try to find the best textarea
        let currentValue = (testValueElement as HTMLInputElement).value || '';

        // For boolean exp-select, get value from match text
        if (type === 'Boolean' && testValueElement.tagName.toLowerCase() === 'exp-select') {
          const matchText = testValueElement.querySelector(AD_WIDGETS.select.text);
          currentValue = matchText?.textContent?.trim() ?? '';
          log.debug(`Got boolean value from select: ${currentValue}`);
        }

        // For structured data, if the main textarea contains "[object Object]", try the default_value textarea
        if (isStructuredData && currentValue === '[object Object]') {
          const testCaseRow = container.querySelector(AD_INPUTS.testCaseRow);
          if (testCaseRow) {
            const defaultTextarea = testCaseRow.querySelector<HTMLTextAreaElement>(AD_INPUTS.structuredDefault);
            if (defaultTextarea && defaultTextarea.value && defaultTextarea.value !== '[object Object]') {
              currentValue = defaultTextarea.value;
              log.debug(`Using default_value textarea for structured data: ${currentValue.substring(0, 50)}...`);
            }
          }
        }

        // Check if mandatory
        const mandatory = isMandatory(container);

        inputs.push({
          key,
          name,
          type,
          testValueElement,
          mandatory,
          currentValue,
          container
        });

        log.debug(`Extracted input: ${key} (${name}) - Type: ${type}, Mandatory: ${mandatory}`);
      } catch (error) {
        log.error(`Error processing input ${key}:`, error);
      }
    }

    log.debug(`Successfully extracted ${inputs.length} inputs`);
    
    // Update cache
    state.cachedInputs = inputs;
    state.lastInputScanTime = now;

    return inputs;
  } catch (error) {
    log.error('Error in extractAllInputs:', error);
    return [];
  }
}
