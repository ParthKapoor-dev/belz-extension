# `tests/options/`

Unit tests for the options page in [`src/options/`](../../src/options/): the **Allowed sites** list.

## Contents

| File | Source under test | What it covers |
|---|---|---|
| [`options-page.test.ts`](options-page.test.ts) | [`options-page.ts`](../../src/options/options-page.ts) | The real `OptionsPage` over the real `options.html` markup: Add asks for the permission first and stores the normalised host; an invalid host is refused without asking; a denied request stores nothing; a seeded entry shows **Grant** and granting clears `seeded`; a row follows the browser, not the stored `enabled` flag, and the page writes nothing itself; an out-of-band `permissions.onRemoved` repaints; **Revoke** removes the entry and the permission, and a refused removal changes nothing; **Grant** on one host and **Revoke** on another at once never bring the revoked one back and keep the order; the designer host is saved on blur, normalised, cleared when blank and refused when invalid; `start()` is idempotent and `stop()` removes every listener. |

## How it works

`beforeAll` loads [`options.html`](../../src/options/options.html), keeps its `<body>` without the `<script>` tag, puts it in the document, and starts one `OptionsPage`. Each test resets the fake `chrome` (see [`../fakes/`](../fakes/)) and has `fakeChrome.runtime.respond` hand the page's messages to a `ContentScriptSync` (the background's list owner, not started), as sent by `optionsPageSender`; `fakeChrome.permissions.allowRequest` / `allowRemove` make the browser deny a request or refuse a removal, and `fakeChrome.permissions.requested` records what was asked. Events are dispatched on the real form and inputs, then the test waits a few macrotasks for the page's promise chains to settle. `afterAll` calls `stop()`.

## Conventions

Assertions read text, class names and plain values only, never elements (see [`../README.md`](../README.md)).
