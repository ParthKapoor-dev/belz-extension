# `src/designer/features/curl-autofill/`

Fills a method's test inputs when the AD page is opened from the AD Network DevTools panel's **Open** action. The panel puts the request body in the URL; this code reads it and writes it into the inputs. AD pages only.

## Contents

| File | What it does |
|---|---|
| [`index.ts`](index.ts) | `startCurlAutofillFeature()` and `decodeAutofillParam()` |

## How it works

1. `ad-content.ts` calls `startCurlAutofillFeature()` once on page load. It does nothing unless the path starts with `AD_ROUTE_PREFIX` and the URL has the `AUTOFILL_PARAM` query parameter (`config/endpoints.ts`).
2. `decodeAutofillParam()` base64-decodes the parameter and checks it parses as JSON. The parameter is then removed with `history.replaceState`, so a reload does not fill the inputs again.
3. It polls (`TIMINGS.autofillTitlePoll`) until `document.title` changes, as a sign that the app has rendered the method. That is only a hint: after `TIMINGS.autofillGiveUp` it goes on regardless.
4. It then polls (`TIMINGS.autofillInputPoll`) until `extractAllInputs()` finds inputs, waits `TIMINGS.autofillSettle`, and calls `syncJSONToInputs()` from the JSON editor. If no inputs appear within `TIMINGS.autofillGiveUp`, it stops polling, logs a warning and shows a toast; nothing is filled.
5. A toast reports how many inputs were filled. Missing keys and failures are logged.

## How it connects

- **Used by:** `ad-content.ts`. The URL is built by the AD Network panel in `src/devtools/ad-network/`.
- **Depends on:** `json-editor/extractor.ts` and `json-editor/sync.ts`, `ui/toast.ts`, `config/endpoints.ts`, `config/routes.ts`, `config/selectors.ts` (`AD_INPUTS.keyElements`, for a log line), `config/timings.ts`.

## Conventions

This is not a `Feature` and has no setting: it runs once per page load, only when the parameter is present, which only happens when the user clicks **Open** in the AD Network panel. Both polls are bounded (`TIMINGS.autofillGiveUp`), so it never outlives that one attempt.

## Testing

[`tests/designer/features/page-helpers.test.ts`](../../../../tests/designer/features/page-helpers.test.ts) covers `decodeAutofillParam()`. The sync it calls is tested with the JSON editor. How to run them is in the Development section of the [root README](../../../../README.md).
