# `store/`

The Chrome Web Store listing, ready to paste into the Developer Dashboard: the listing text, the answers to the **Privacy practices** tab, and the screenshots to take. Nothing here ships in the extension or is read by the build.

Keep it in step with the extension: when a permission, a feature or what is stored changes, update the matching section here, [`PRIVACY.md`](../PRIVACY.md) and the root [README](../README.md#privacy-and-permissions) ("Privacy and permissions") in the same commit. How releases reach the store is in the root README's [Releasing](../README.md#releasing) section and [`.github/workflows/README.md`](../.github/workflows/README.md).

## Store listing tab

**The listing names no product or company.** The extension is built for one vendor's low-code designers, but the public listing describes what it does in generic terms ("low-code designer sites", "a network panel", "a component inspector") and shows no internal names, hostnames or real data. The repo itself keeps the real names. Keep it that way when editing anything below, the manifest's `description` and the screenshots.

**Name** (from `manifest.json`): `belz DevTools`

**Summary.** The store shows the manifest's `description` (at most 132 characters), currently:

> Developer tools for low-code designer sites: a code editor for text boxes, a JSON input editor, shortcuts and two DevTools panels.

**Category:** Developer Tools.

**Language:** English.

**Description:**

```text
belz DevTools adds productivity tools for engineers who build on a low-code platform's web designers: one for server-side methods and one for pages.

It works only on the sites you add on its options page, one at a time, each with its own browser permission. It starts with access to no site.

On the designer pages
- Code editor: open any text box in a full-screen editor with syntax highlighting, search, autocomplete, SQL and JSON formatting, and an optional Vim mode. Published, read-only content opens read-only.
- #{variable} intellisense: complete, explain and check the variables a method can use (its inputs, internal variables and earlier steps' outputs), read live from the page.
- JSON input editor: edit all of a method's test inputs as one JSON document and sync them back into each field with the right type (text, number, boolean, date, JSON, lists).
- Keyboard shortcuts to run a test and copy a link, a copy button on outputs, and readable tab titles.
- A settings window switches each feature on or off.

Two DevTools panels
- A network panel that lists the method calls a page makes, each named instead of shown as a bare ID, with headers, payload, response and timing; copy as cURL, copy a link, or open the method with its test inputs filled in.
- A component inspector that shows a published page's component tree and which component rendered the element you point at.

Privacy: no analytics, no telemetry, no server of its own. The extension talks only to the site you are on, using the sign-in you already have there, and sends nothing to its developer or to third parties.
```

**Graphics:**

- **Store icon:** 128×128 PNG with the artwork in the middle 96×96, rendered from [`icons/icon.svg`](../icons/icon.svg) as [`icons/README.md`](../icons/README.md) shows.
- **Screenshots:** 1280×800 (the store also takes 640×400), at least one and up to five. They are taken on a local demo page, never on a real site: a static HTML file with made-up content (an "Order report" method with inputs such as `customerId`, `startDate`, `includeArchived` and a SQL step over `orders` / `customers` tables), whose markup carries just the classes and ids the extension looks for (`src/config/selectors.ts`, like `tests/e2e/page.html` and `tests/fixtures/ad-inputs.ts`). The packaged `build/chrome` tree is copied with its manifest patched the way `tests/e2e/run.mjs` does it (a static content script on the local page), loaded in headless Chromium, and each window is opened through its real button or shortcut and captured over the DevTools protocol (`Emulation.setDeviceMetricsOverride` 1280×800 at scale 1, then `Page.captureScreenshot`). The settings descriptions that name the designers are reworded on the page before that capture. The script is kept outside the repo. Current set:
  1. The code editor over a SQL text box after Format, with the `#{` completion list open.
  2. The JSON input editor on the demo method's five inputs.
  3. The Settings window.
- **Small promo tile** (440×280): optional.

## Privacy practices tab

**Single purpose:**

> Developer tooling for a low-code platform's web designers: editing helpers on its designer pages, and DevTools panels that name the method calls a page makes and identify the components of a published page, on sites the user has added.

**Permission justifications** (one per permission in [`manifest.json`](../manifest.json)):

| Permission | Justification |
|---|---|
| `storage` | Stores the user's settings, the list of sites the user allowed, and a cache of method names looked up from those sites (at most 800, dropped after 14 days). Session storage passes one request's test inputs to the tab the network panel opens (one use, at most 5 minutes) and a keyboard-shortcut marker for a DevTools panel (60 seconds). |
| `scripting` | Registers the extension's content scripts on the sites the user has granted, and only on their designer and published pages, so the list follows the user's grants and revocations. |
| Host permission (`optional_host_permissions: https://*/*`) | The extension starts with access to no site. The user adds each site on the options page, and the browser asks for that one site's permission (`https://<site>/*`); the user can revoke it at any time. It is needed to run the editing helpers on that site and to look up method names from that site's own API. |
| `devtools_page` | Adds the network panel and the component inspector, shown only when DevTools inspects an allowed site. |
| `commands` | Keyboard shortcuts to open the settings and focus the DevTools panels. |

**Are you using remote code?** No. All code is in the package. The content scripts load their own packaged modules (`dist/modules/*`, listed in `web_accessible_resources`); the DevTools panel runs fixed scripts from the package in the inspected page.

**Data usage.** The extension handles some data locally and sends it only to the site the user is on; none of it reaches the developer or anyone else. Tick:

- **Authentication information:** the network panel reuses the page's own sign-in (the authorization header the page sent, or the token in the page's storage) to call that same site's API for method names. Kept in memory while DevTools is open, never stored or sent elsewhere.
- **Website content:** the extension reads the designer pages' contents and, in DevTools, the page's method-call requests and responses, to show them to the user.

Leave the others unticked (personally identifiable, health, financial and payment information, personal communications, location, web history, user activity).

Certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** the published [`PRIVACY.md`](../PRIVACY.md), for example `https://github.com/ParthKapoor-dev/belz-extension/blob/main/PRIVACY.md`.

## Distribution tab

**Visibility:** Unlisted (only people with the link can install it), or as the maintainer chooses. This is set in the dashboard, never in code.
