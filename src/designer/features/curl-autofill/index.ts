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

/** Resolves true once `ready()` holds, or false after `timeoutMs`, checking every `intervalMs`. */
function pollUntil(ready: () => boolean, intervalMs: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = setInterval(() => {
      if (ready()) {
        clearInterval(check);
        resolve(true);
      } else if (Date.now() >= deadline) {
        clearInterval(check);
        resolve(false);
      }
    }, intervalMs);
  });
}

async function waitForPageTitleThenSync(jsonString: string): Promise<void> {
  // A title change is the sign that the app has rendered the method. It is
  // only a hint: if it never changes (the title was already final when this
  // script ran), go on and look for the inputs anyway.
  const initialTitle = document.title;
  log.debug('waiting for page title (current:', JSON.stringify(initialTitle), ')');
  const titled = await pollUntil(
    () => Boolean(document.title) && document.title !== initialTitle,
    TIMINGS.autofillTitlePoll,
    TIMINGS.autofillGiveUp
  );
  if (titled) log.debug('page title ready:', JSON.stringify(document.title), '— starting input poll');
  else log.debug(`page title did not change within ${TIMINGS.autofillGiveUp} ms — looking for inputs anyway`);

  let attempt = 0;
  const found = await pollUntil(
    () => {
      attempt++;
      const count = extractAllInputs().length;
      log.debug(`attempt ${attempt}: ${count} inputs extracted (${document.querySelectorAll(AD_INPUTS.keyElements).length} INPUT_LIST_* ids)`);
      return count > 0;
    },
    TIMINGS.autofillInputPoll,
    TIMINGS.autofillGiveUp
  );
  if (!found) {
    log.warn(`no test inputs appeared within ${TIMINGS.autofillGiveUp} ms; autofill gave up`);
    toast.show('Autofill: the method\'s inputs did not appear, nothing was filled');
    return;
  }

  // Small pause to let Angular finish any pending bindings after the last render
  await new Promise((r) => setTimeout(r, TIMINGS.autofillSettle));

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
}
