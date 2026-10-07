# `store/`

The Chrome Web Store listing, ready to paste into the Developer Dashboard: the listing text, the answers to the **Privacy practices** tab, and the screenshots to take. Nothing here ships in the extension or is read by the build.

Keep it in step with the extension: when a permission, a feature or what is stored changes, update the matching section here, [`PRIVACY.md`](../PRIVACY.md) and the root [README](../README.md#privacy-and-permissions) ("Privacy and permissions") in the same commit. How releases reach the store is in the root README's [Releasing](../README.md#releasing) section and [`.github/workflows/README.md`](../.github/workflows/README.md).

## Store listing tab

**Name** (from `manifest.json`): `belz DevTools`

**Summary.** The store shows the manifest's `description` (at most 132 characters), currently:

> AD Network and PD Inspector DevTools panels plus Automation/Page Designer helpers

A plainer alternative (124 characters); to use it, change `description` in [`manifest.json`](../manifest.json):

> DevTools panels and editing helpers for Service Designer: trace Automation Designer calls, inspect Page Designer components.

**Category:** Developer Tools.

**Language:** English.

**Description:**

```text
belz DevTools adds productivity tools for engineers working in Service Designer's Automation Designer (AD) and Page Designer (PD), plus two DevTools panels.

It works only on the Service Designer sites you add on its options page, one at a time, each with its own browser permission. It starts with access to no site.

In Automation Designer and Page Designer
- IDE: open any text box in a full-screen code editor with syntax highlighting, search, autocomplete, SQL and JSON formatting, and an optional Vim mode. Published methods open read-only.
- #{variable} intellisense (AD): complete, explain and check the method's inputs, internal variables and step outputs, read live from the page.
- Edit a method's inputs as one JSON document and sync them back into each field with the right type.
- Run Test from anywhere (Ctrl+Shift+Enter), copy a link to the method (Shift+L), copy outputs, and readable tab titles.
- A settings modal switches each feature on or off.

DevTools: AD Network
- Lists every Automation Designer method call the page makes, with each method's name and category instead of a bare ID.
- Headers, payload, response and timing for each call; copy as cURL, copy a Slack link, and open the method's draft with its inputs filled in.

DevTools: PD Inspector
- Shows a published page's Page Designer component tree, and which component rendered the element you point at.

Privacy: no analytics, no telemetry, no server of its own. The extension talks only to the site you are on, using the sign-in you already have there, and sends nothing to its developer or to third parties.
```

**Graphics:**

- **Store icon:** 128×128 PNG.
- **Screenshots:** 1280×800 (the store also takes 640×400), at least one and up to five. Take them on an allowed site with no internal hostnames, customer data or tokens visible (crop the address bar or use a demo instance):
  1. The AD Network panel with several named method calls listed, one row open on its Payload tab.
  2. The IDE open over an AD text box with SQL, the `#{` completion list showing, and the footer's variable count.
  3. The JSON input editor open on a method's Inputs.
  4. The PD Inspector panel with its component tree, Inspect on and a component highlighted on the page.
  5. The Settings modal.
- **Small promo tile** (440×280): optional.

## Privacy practices tab

**Single purpose:**

> Developer tooling for Service Designer: editing helpers on Automation Designer and Page Designer pages, and DevTools panels that trace Automation Designer method calls and identify Page Designer components, on sites the user has added.

**Permission justifications** (one per permission in [`manifest.json`](../manifest.json)):

| Permission | Justification |
|---|---|
| `storage` | Stores the user's settings, the list of sites the user allowed, and a cache of Automation Designer method names (at most 800, dropped after 14 days). Session storage passes an "Open in draft" request's inputs to the tab it opens (one use, at most 5 minutes) and a keyboard-shortcut marker for a DevTools panel (60 seconds). |
| `scripting` | Registers the extension's content scripts on the sites the user has granted, and only on their Automation Designer, Page Designer and published pages, so the list follows the user's grants and revocations. |
| Host permission (`optional_host_permissions: https://*/*`) | The extension starts with access to no site. The user adds each Service Designer site on the options page, and the browser asks for that one site's permission (`https://<site>/*`); the user can revoke it at any time. It is needed to run the editing helpers on that site and to look up method names from that site's own API. |
| `devtools_page` | Adds the AD Network and PD Inspector panels, shown only when DevTools inspects an allowed site. |
| `commands` | Keyboard shortcuts to open the settings and focus the DevTools panels. |

**Are you using remote code?** No. All code is in the package. The content scripts load their own packaged modules (`dist/modules/*`, listed in `web_accessible_resources`); the DevTools panel runs fixed scripts from the package in the inspected page.

**Data usage.** The extension handles some data locally and sends it only to the site the user is on; none of it reaches the developer or anyone else. Tick:

- **Authentication information:** the AD Network panel reuses the page's own sign-in (the authorization header the page sent, or the token in the page's storage) to call that same site's API for method names. Kept in memory while DevTools is open, never stored or sent elsewhere.
- **Website content:** the extension reads the designer pages' contents and, in DevTools, the page's Automation Designer requests and responses, to show them to the user.

Leave the others unticked (personally identifiable, health, financial and payment information, personal communications, location, web history, user activity).

Certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** the published [`PRIVACY.md`](../PRIVACY.md), for example `https://github.com/ParthKapoor-dev/belz-extension/blob/main/PRIVACY.md`.

## Distribution tab

**Visibility:** Unlisted (only people with the link can install it), or as the maintainer chooses. This is set in the dashboard, never in code.
