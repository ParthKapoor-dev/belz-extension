# `src/designer/features/curl-autofill/`

Fills a method's test inputs when the AD page was opened by the AD Network DevTools panel's **Open in draft** action. The request body never travels in the URL: the panel leaves it in extension storage and puts a one-time id in the URL fragment; this code asks the background for the body and writes it into the inputs. AD pages of allowed sites only.

## Contents

| File | What it does |
|---|---|
| [`index.ts`](index.ts) | `startCurlAutofillFeature()` and `parseAutofillFragment()` |

## How it works

1. `ad-content.ts` calls `startCurlAutofillFeature()` once on page load. It does nothing unless the path starts with `AD_ROUTE_PREFIX` and the fragment carries `AUTOFILL_FRAGMENT_PARAM` (`#belz-autofill=<id>`, from `config/namespace.ts`).
2. `parseAutofillFragment()` returns the id and the fragment without that one parameter. `history.replaceState` writes the URL back with only the marker removed: the query, the rest of the fragment and `history.state` (the app's router keeps its own state there) stay. A reload therefore does not ask again.
3. It sends `{ [AUTOFILL_MESSAGE_KEY]: 'take', id }` (`TakeAutofillMessage` in `shared/messages.ts`). The background ([`background/relay.ts`](../../../background/relay.ts)) answers only this extension's content script on an AD page of a granted https site, and takes the body out of storage (`takeHandoff()` in [`shared/autofill-handoff.ts`](../../../shared/autofill-handoff.ts)), so it can be read once and only while fresh. No body (the link was copied, reused, forged or has expired) means nothing is filled. A body that is not JSON is logged and ignored.
4. It polls (`TIMINGS.autofillTitlePoll`) until `document.title` changes, as a sign that the app has rendered the method. That is only a hint: after `TIMINGS.autofillGiveUp` it goes on regardless.
5. It then polls (`TIMINGS.autofillInputPoll`) until `extractAllInputs()` finds inputs, waits `TIMINGS.autofillSettle`, and calls `syncJSONToInputs()` from the JSON editor. If no inputs appear within `TIMINGS.autofillGiveUp`, it stops polling, logs a warning and shows a toast; nothing is filled.
6. A toast reports how many inputs were filled. Missing keys and failures are logged.

## How it connects

- **Used by:** `ad-content.ts`. The URL and the stored body come from `withAutofill()` in `src/devtools/ad-network/open-draft.ts`.
- **Depends on:** `json-editor/extractor.ts` and `json-editor/sync.ts`, `ui/toast.ts`, `config/namespace.ts`, `config/routes.ts`, `config/selectors.ts` (`AD_INPUTS.keyElements`, for a log line), `config/timings.ts`, `shared/messages.ts`, and the background relay (`chrome.runtime.sendMessage`).

## Conventions

This is not a `Feature` and has no setting: it runs once per page load, only when the marker is present. Both polls are bounded (`TIMINGS.autofillGiveUp`), so it never outlives that one attempt. The content script only runs on allowed sites, and the background checks the sender again before handing a body over.

## Testing

[`tests/designer/features/autofill.test.ts`](../../../../tests/designer/features/autofill.test.ts) runs the handoff end to end (panel, background relay, this page): a non-Latin-1 body is filled, the query and the rest of the fragment are kept, a link without a stored body fills nothing, a handoff is used once, and a site that is not allowed gets nothing. [`tests/designer/features/page-helpers.test.ts`](../../../../tests/designer/features/page-helpers.test.ts) covers `parseAutofillFragment()`. How to run them is in the Development section of the [root README](../../../../README.md).
