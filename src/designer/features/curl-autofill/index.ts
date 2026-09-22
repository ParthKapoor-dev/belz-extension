import { syncJSONToInputs } from '../json-editor/sync';
import { extractAllInputs } from '../json-editor/extractor';
import { toast } from '../../ui/toast';
import { AUTOFILL_PARAM } from '../../../config/endpoints';
import { AD_ROUTE_PREFIX } from '../../../config/routes';
import { AD_INPUTS } from '../../../config/selectors';
import { TIMINGS } from '../../../config/timings';
import { createLogger } from '../../../shared/logger';

const log = createLogger('curl-autofill');


/**
 * The JSON request body carried by the autofill URL parameter, or null when
 * the parameter is absent or does not decode to valid JSON.
 */
export function decodeAutofillParam(search: string): string | null {
  const encoded = new URLSearchParams(search).get(AUTOFILL_PARAM);
  if (!encoded) return null;
  try {
    const jsonString = atob(encoded);
    JSON.parse(jsonString);
    return jsonString;
  } catch (err) {
    log.warn('failed to decode/parse param:', err);
    return null;
  }
}

export function startCurlAutofillFeature(): void {
  if (!window.location.pathname.startsWith(AD_ROUTE_PREFIX)) return;
  if (!new URLSearchParams(window.location.search).has(AUTOFILL_PARAM)) return;

  // The parameter is consumed once: strip it before anything else, so a
  // reload does not autofill a second time.
  log.debug('param detected, removing from URL');
  const jsonString = decodeAutofillParam(window.location.search);
  history.replaceState(null, '', window.location.pathname);
  if (!jsonString) return;

  log.debug('decoded JSON successfully, keys:', Object.keys(JSON.parse(jsonString)));
  waitForPageTitleThenSync(jsonString);
}

function waitForPageTitle(): Promise<string> {
  const initialTitle = document.title;
  log.debug('waiting for page title (current:', JSON.stringify(initialTitle), ')');
  return new Promise<string>(resolve => {
    const check = setInterval(() => {
      const current = document.title;
      if (current && current !== initialTitle) {
        clearInterval(check);
        resolve(current);
      }
    }, TIMINGS.autofillTitlePoll);
  });
}

async function waitForPageTitleThenSync(jsonString: string): Promise<void> {
  const title = await waitForPageTitle();
  log.debug('page title ready:', JSON.stringify(title), '— starting input poll');

  let attempt = 0;

  const timer = setInterval(async () => {
    attempt++;

    const rawCount = document.querySelectorAll(AD_INPUTS.keyElements).length;
    const inputs = extractAllInputs();
    log.debug(`attempt ${attempt}: ${inputs.length} inputs extracted (${rawCount} INPUT_LIST_* ids)`);
    if (inputs.length === 0) return;

    clearInterval(timer);

    // Small pause to let Angular finish any pending bindings after the last render
    await new Promise(r => setTimeout(r, TIMINGS.autofillSettle));

    log.debug('calling syncJSONToInputs...');
    const result = await syncJSONToInputs(jsonString);
    log.debug('sync result:', JSON.stringify(result, null, 2));

    if (result.skippedMissingKeys?.length) {
      log.debug('skipped (no matching input on page):', result.skippedMissingKeys);
    }
    if (result.failedKeys?.length) {
      log.warn('failed to populate:', result.failedKeys);
    }
    if (result.errors?.length) {
      log.warn('errors:', result.errors);
    }

    if (result.success) {
      toast.show(`Autofill: filled ${result.filledCount} input${result.filledCount === 1 ? '' : 's'}`);
    } else {
      toast.show(`Autofill: filled ${result.filledCount}, check console for details`);
    }
  }, TIMINGS.autofillInputPoll);
}
