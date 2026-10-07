# Privacy policy

This policy covers the **belz DevTools** browser extension (this repository), in every form it is distributed: the Chrome Web Store item, the signed Firefox add-on, and builds from source.

**In short:** the extension sends nothing to its developer or to anyone else. It works only on the sites you add yourself, and the only server it talks to is the site you are on, as the signed-in user you already are there.

## What the extension reads

Only on sites you have added and granted on its options page, and only over https:

- **The pages themselves.** On the platform's designer pages it reads the page's contents (step inputs, variable names, text areas) to provide its editing tools.
- **Network requests, in the DevTools panel.** While DevTools is open on an allowed site, the network panel shows that page's method-call requests: their addresses, headers, request bodies and responses.
- **Authentication information.** To look up a method's name and category, the network panel calls the same site's own API with the sign-in you already have there: the authorization header the page itself sent, or the sign-in token the page keeps in its own storage. It is used only for requests to the site it came from, never follows a redirect to another site, and is held in memory only while DevTools is open on that site: it is forgotten when the tab navigates or DevTools closes. It is never stored.
- **Published page configuration.** The component inspector panel reads the published page's configuration from the same site.

On any other site the extension reads nothing and changes nothing.

## Where it goes

To the site you are on, and nowhere else. The extension has no server, no analytics, no telemetry, no advertising and no third-party services. Its developer never receives any of your data. Nothing is sold, shared or transferred to anyone, and nothing is used for any purpose other than the features described in the [README](README.md).

Text you copy with the extension (a link, an output value, editor text) goes to your system clipboard, as you asked. It reads the clipboard only when you paste from it in the editor's Vim mode (`"+p`).

## What is stored, and for how long

Everything stays in your browser's own extension storage, on your device:

- **Your settings and your list of allowed sites**, until you change them or remove the extension.
- **A cache of method names and categories**, per site: at most 800 entries, used as they are for 6 hours, refreshed in the background up to 14 days, then dropped.
- **Two short-lived items in session storage**, which the browser clears when it closes: a request's test inputs, handed from the network panel to the tab it opens, used once and discarded after at most 5 minutes; and the marker a focus shortcut leaves for a DevTools panel, honoured for 60 seconds.

Removing the extension deletes all of it.

## Permissions

- **Storage:** the settings, site list and cache above.
- **Scripting:** to run the extension's scripts on the sites you allowed, and only on their designer and published pages.
- **Optional access to https sites:** the extension starts with access to no site. Each site you add asks for its own permission, which you can revoke at any time from the options page or the browser's settings.
- **DevTools page:** adds the network panel and the component inspector, only when DevTools inspects an allowed site.
- **Keyboard commands:** the browser-level shortcuts that open the settings and focus the panels.

The [README](README.md#privacy-and-permissions) explains each in more detail.

## Changes and contact

If what the extension does with data changes, this policy changes with it, in the same repository. Questions: open an issue at https://github.com/ParthKapoor-dev/belz-extension/issues.
