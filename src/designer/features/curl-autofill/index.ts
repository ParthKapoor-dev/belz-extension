// "Open in draft" autofill: fills the method's test inputs with the request
// body the AD Network panel handed over when it opened this tab.
//
// The URL only carries a one-time id in its fragment (`#belz-autofill=<id>`);
// the body itself waits in extension storage, and the background hands it to
// this page once (see shared/autofill-handoff.ts and background/relay.ts). A
// link without a stored body behind it (copied, reopened, forged) fills
// nothing. This script only runs on Automation Designer pages of allowed
// sites, and the background checks that again before answering.
import { syncJSONToInputs } from '../json-editor/sync';
import { extractAllInputs } from '../json-editor/extractor';
import { toast } from '../../ui/toast';
import { AUTOFILL_FRAGMENT_PARAM, AUTOFILL_MESSAGE_KEY } from '../../../config/namespace';
import { AD_ROUTE_PREFIX } from '../../../config/routes';
import { AD_INPUTS } from '../../../config/selectors';
import { TIMINGS } from '../../../config/timings';
import { createLogger } from '../../../shared/logger';
import type { TakeAutofillMessage } from '../../../shared/messages';

const log = createLogger('curl-autofill');

/**
 * The handoff id in a URL fragment such as `#belz-autofill=<id>` or
 * `#tab=2&belz-autofill=<id>`, and the fragment without that one parameter
 * (everything else kept as it was; '' when nothing is left).
 */
export function parseAutofillFragment(hash: string): { id: string | null; rest: string } {
  const parts = hash.replace(/^#/, '').split('&').filter((part) => part !== '');
  const prefix = `${AUTOFILL_FRAGMENT_PARAM}=`;
  const mine = parts.find((part) => part.startsWith(prefix));
  if (!mine) return { id: null, rest: hash };
  const others = parts.filter((part) => part !== mine);
  return { id: mine.slice(prefix.length) || null, rest: others.length ? `#${others.join('&')}` : '' };
}

/** Ask the background for the body stored under `id`; null when there is none. */
async function takeBody(id: string): Promise<string | null> {
  const message: TakeAutofillMessage = { [AUTOFILL_MESSAGE_KEY]: 'take', id };
  try {
    const body: unknown = await chrome.runtime.sendMessage(message);
    return typeof body === 'string' ? body : null;
  } catch (err) {
    log.warn('cannot reach the extension for the autofill body:', err);
    return null;
  }
}

/**
 * Consume this page's autofill handoff, if its URL has one: remove the marker
 * from the URL (and only the marker: the query and the rest of the fragment
 * stay), fetch the body, and fill the inputs once they render. Resolves once
 * the body is known; the fill itself goes on after that.
 */
export async function startCurlAutofillFeature(): Promise<void> {
  if (!window.location.pathname.startsWith(AD_ROUTE_PREFIX)) return;
  const { id, rest } = parseAutofillFragment(window.location.hash);
  if (!id) return;

  // Consumed once: strip the marker before anything else, so a reload does
  // not ask again. The history state is kept: the app's router keeps its own there.
  const { pathname, search } = window.location;
  history.replaceState(history.state, '', pathname + search + rest);

  const jsonString = await takeBody(id);
  if (!jsonString) {
    log.debug('no autofill body for this link (already used, expired, or not from this browser)');
    return;
  }
  try {
    log.debug('autofill body received, keys:', Object.keys(JSON.parse(jsonString) as object));
  } catch (err) {
    log.warn('the autofill body is not JSON:', err);
    return;
  }
  void waitForPageTitleThenSync(jsonString);
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
