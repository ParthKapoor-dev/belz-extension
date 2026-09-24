# `src/shared/`

Small helpers used by more than one JavaScript world: content scripts, background, DevTools pages
and the options page. Each world bundles its own copy, so nothing here shares memory at runtime.
Worlds share data only through `chrome.storage` and messages, and this folder defines both shapes.

## Contents

| File / directory | What it does |
|---|---|
| [`hosts.ts`](hosts.ts) | The allowed-sites list: `HostEntry`, `normalizeHost()`, `hostPattern()`, `httpsHostOf()`, `isAllowedUrl()`, `readHosts()`, `readEnabledHosts()`, `enabledHostSet()`, `writeHosts()` (the background only), `isGranted()`, `readGrants()`, `isHostsChange()`. |
| [`logger.ts`](logger.ts) | `createLogger(scope)`: the extension's only console output, printed as `[belz:<scope>]`. |
| [`messages.ts`](messages.ts) | Every message shape that crosses worlds (`PdCommand`, `PdPushMessage`, `PdRelayMessage`, `OpenSettingsMessage`, `HostsEdit`, `TakeAutofillMessage`, `FocusFlag`), their full-shape guards, and the sender checks `isFromExtension()` / `isFromExtensionPage()` / `isFromOptionsPage()`. |
| [`autofill-handoff.ts`](autofill-handoff.ts) | The "Open in draft" handoff: `storeHandoff()` (panel side), `takeHandoff()` (background side), `isHandoffId()`, `HANDOFF_TTL_MS`. |
| [`rich-link.ts`](rich-link.ts) | `escapeHtml()`, `richLink()` and `copyRichLink()`: a link that pastes as a clickable label, with the label escaped. |
| [`errors.ts`](errors.ts) | `errorText(err)`: an error's message for people, `''` when there is nothing to say. |
| [`retry.ts`](retry.ts) | `isTransientStatus(status)`: 408, 429 or 5xx, the HTTP answers worth retrying (the AD Network lookups and the PD Inspector's config fetches). |
| [`dom.ts`](dom.ts) | `required(selector)`: an element the extension's own page HTML must contain; throws if missing. |
| [`focus-flag.ts`](focus-flag.ts) | `writeFocusFlag()` (background side) and `watchFocusFlag()` (panel side) for the `Ctrl+Shift+A` / `Ctrl+Shift+P` shortcuts. |

## How it works

- **`hosts.ts`** reads and writes `HOSTS_STORAGE_KEY` in `chrome.storage.local`. It is stateless:
  every call reads storage afresh. `readHosts()` drops any entry without a string `host` and a boolean
  `enabled`. `hostPattern()` is always https: it is both the match pattern of a content script and the
  origin a host's permission is requested and checked for. `httpsHostOf()` returns the normalised host
  of an https URL and null for any other scheme; `enabledHostSet()` is the normalised granted hosts.
  `isAllowedUrl(url, allowed)` is the one allowed-site check (https, and a host in `allowed`), used by
  the background relay, the DevTools page and the AD Network panel. `isGranted()` and `readGrants()`
  ask `chrome.permissions.contains`, the authority on grants, and write nothing. Only the background
  calls `writeHosts()`: every change to the list (the options page's, and the grant sync that stores
  each `enabled` flag as the browser reports it) runs in its one queue, in `ContentScriptSync`
  ([`background/content-scripts.ts`](../background/content-scripts.ts)).
- **`logger.ts`** keeps a `DebugSwitch` that follows the `debugLogging` setting through
  `chrome.storage`. Warnings and errors always print; debug and info print only while Debug Logging is
  on. In code without extension APIs it stays off.
- **`messages.ts`** holds types plus guards (`isPdCommand`, `isPdPick`, `isPdRouteChanged`,
  `isPdRelay`, `isOpenSettings`, `isHostsEdit`, `isTakeAutofill`). The guards check the whole shape, not only a tag:
  `isPdCommand` accepts only the four known commands with their fields, and `isPdRelay` also checks the
  `tabId` and the command inside. Who may send a message is the receiver's check: `isFromExtension()`
  (this extension, not another) and `isFromExtensionPage()` (one of its own pages: no `sender.tab`,
  and a `sender.url` on the extension's own origin; never a content script) and `isFromOptionsPage()`
  (such a page at `OPTIONS_PAGE`, the only sender of a `HostsEdit`). A sender and its receiver use the same type, so renaming a field breaks the type check
  rather than the feature.
- **`autofill-handoff.ts`** keeps a request body in `chrome.storage.session` under
  `AUTOFILL_HANDOFF_KEY_PREFIX` plus a random 32-hex id. Only the id travels in the opened URL's
  fragment. `takeHandoff()` removes the body as it reads it, refuses it after `HANDOFF_TTL_MS`, and
  drops other handoffs that expired unread. It reads, then removes, so its caller (the background
  relay) runs takes one at a time: a body is handed over at most once.
- **`rich-link.ts`** builds the `text/html` and Markdown forms of a link. The label comes from the page
  or the platform API, so it is escaped; a URL that is not http(s) is written as plain text.
- **`focus-flag.ts`** stores a `FocusFlag` under `FOCUS_STORAGE_KEY` in `chrome.storage.session`
  (every supported browser has it: Firefox 128 or newer, current Chromium). `writeFocusFlag()` never rejects: a failed write is logged. A
  panel's watcher reacts to a flag for its target that is at most 60 s old, including one written
  before the panel loaded.

## How it connects

- **Used by:** `hosts.ts` by [`background/`](../background/), [`options/`](../options/),
  [`devtools/panel-registrar.ts`](../devtools/panel-registrar.ts) and
  [`devtools/ad-network/origin.ts`](../devtools/ad-network/origin.ts). `logger.ts` and `errors.ts` by
  every world. `messages.ts` by the background, the PD Inspector panel and engine
  ([`devtools/pd-inspector/`](../devtools/pd-inspector/), [`pd-inspector-page/`](../pd-inspector-page/)),
  and the designer settings and autofill features ([`designer/`](../designer/)).
  `autofill-handoff.ts` by the AD Network panel ([`devtools/ad-network/`](../devtools/ad-network/)) and
  the background relay. `rich-link.ts` by the AD Network panel and the Shift+L shortcut. `dom.ts` by the
  options page and both DevTools panels. `focus-flag.ts` by the background and both panels. `retry.ts`
  by the AD Network panel's lookups and the PD Inspector's config fetches
  ([`pd-inspector-page/`](../pd-inspector-page/)).
- **Depends on:** [`config/storage-keys.ts`](../config/storage-keys.ts),
  [`config/namespace.ts`](../config/namespace.ts) (message keys),
  [`config/extension-files.ts`](../config/extension-files.ts) (`OPTIONS_PAGE`) and the `chrome.storage`
  API.

## Conventions

- All console output goes through `createLogger()`. A test fails if any other file calls `console.*`.
- A new message that crosses worlds gets its type and a full-shape guard in `messages.ts` first, and
  its receiver checks the sender.
- Text from a page or an API that goes into HTML is escaped (`escapeHtml()`).
- Code here must not assume which world it runs in. `logger.ts` holds module state and carries the
  `belz-singleton` marker checked by [`scripts/check-singletons.mjs`](../../scripts/check-singletons.mjs);
  see [AGENTS.md](../../AGENTS.md) ("Content-script module graph").
- `dom.ts` is for the extension's own pages. Selectors on the AD/PD pages live in
  [`config/selectors.ts`](../config/selectors.ts).

## Testing

[`tests/shared/hosts.test.ts`](../../tests/shared/hosts.test.ts) covers `normalizeHost` and host
storage; `readGrants` is covered through the options page and the background tests. [`tests/shared/logger.test.ts`](../../tests/shared/logger.test.ts) covers `createLogger` and
fails on any stray `console.*` call in `src/`.
[`tests/shared/rich-link.test.ts`](../../tests/shared/rich-link.test.ts) covers the escaping. The
message guards and the handoff are covered through their users in
[`tests/background/relay.test.ts`](../../tests/background/relay.test.ts) and
[`tests/designer/features/autofill.test.ts`](../../tests/designer/features/autofill.test.ts). To run
the tests, see the root [README](../../README.md#development)'s Development section.

## Adding or changing things

- **A new field on a stored host:** add it to `HostEntry`. Keep `isHostEntry()` accepting entries that
  lack it, or existing lists will be dropped.
- **A new cross-world message:** add the type and a guard to `messages.ts`, then use the guard and a
  sender check on the receiving side.
