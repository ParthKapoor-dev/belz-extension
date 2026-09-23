# `src/shared/`

Small helpers used by more than one JavaScript world: content scripts, background, DevTools pages
and the options page. Each world bundles its own copy, so nothing here shares memory at runtime.
Worlds share data only through `chrome.storage` and messages, and this folder defines both shapes.

## Contents

| File / directory | What it does |
|---|---|
| [`hosts.ts`](hosts.ts) | The allowed-sites list: `HostEntry`, `normalizeHost()`, `hostPattern()`, `originPattern()`, `readHosts()`, `readEnabledHosts()`, `writeHosts()`, `isHostsChange()`. |
| [`logger.ts`](logger.ts) | `createLogger(scope)`: the extension's only console output, printed as `[belz:<scope>]`. |
| [`messages.ts`](messages.ts) | Every message shape that crosses worlds (`PdCommand`, `PdPushMessage`, `PdRelayMessage`, `OpenSettingsMessage`, `FocusFlag`) and their type guards. |
| [`dom.ts`](dom.ts) | `required(selector)`: an element the extension's own page HTML must contain; throws if missing. |
| [`focus-flag.ts`](focus-flag.ts) | `writeFocusFlag()` (background side) and `watchFocusFlag()` (panel side) for the `Ctrl+Shift+A` / `Ctrl+Shift+P` shortcuts. |

## How it works

- **`hosts.ts`** reads and writes `HOSTS_STORAGE_KEY` in `chrome.storage.local`. It is stateless:
  every call reads storage afresh. `readHosts()` drops any entry without a string `host` and a boolean
  `enabled`.
- **`logger.ts`** keeps a `DebugSwitch` that follows the `debugLogging` setting through
  `chrome.storage`. Warnings and errors always print; debug and info print only while Debug Logging is
  on. In code without extension APIs it stays off.
- **`messages.ts`** holds types plus small guards (`isPdCommand`, `isPdPick`, `isPdRouteChanged`,
  `isPdRelay`, `isOpenSettings`). A sender and its receiver use the same type, so renaming a field
  breaks the type check rather than the feature.
- **`focus-flag.ts`** stores a `FocusFlag` under `FOCUS_STORAGE_KEY` in session storage (local storage
  where session storage is missing). A panel's watcher reacts to a flag for its target that is at most
  60 s old, including one written before the panel loaded.

## How it connects

- **Used by:** `hosts.ts` by [`background/`](../background/), [`options/`](../options/),
  [`devtools/panel-registrar.ts`](../devtools/panel-registrar.ts) and
  [`devtools/ad-network/origin.ts`](../devtools/ad-network/origin.ts). `logger.ts` by every world.
  `messages.ts` by the background, the PD Inspector panel and engine
  ([`devtools/pd-inspector/`](../devtools/pd-inspector/), [`pd-inspector-page/`](../pd-inspector-page/)),
  and the designer settings feature ([`designer/`](../designer/)). `dom.ts` by the options page and
  both DevTools panels. `focus-flag.ts` by the background and both panels.
- **Depends on:** [`config/storage-keys.ts`](../config/storage-keys.ts) and the `chrome.storage` API.

## Conventions

- All console output goes through `createLogger()`. A test fails if any other file calls `console.*`.
- A new message that crosses worlds gets its type and guard in `messages.ts` first.
- Code here must not assume which world it runs in. `logger.ts` holds module state and carries the
  `belz-singleton` marker checked by [`scripts/check-singletons.mjs`](../../scripts/check-singletons.mjs);
  see [AGENTS.md](../../AGENTS.md) ("Content-script module graph").
- `dom.ts` is for the extension's own pages. Selectors on the AD/PD pages live in
  [`config/selectors.ts`](../config/selectors.ts).

## Testing

[`tests/shared/hosts.test.ts`](../../tests/shared/hosts.test.ts) covers `normalizeHost` and host
storage. [`tests/shared/logger.test.ts`](../../tests/shared/logger.test.ts) covers `createLogger` and
fails on any stray `console.*` call in `src/`. To run the tests, see the root
[README](../../README.md#development)'s Development section.

## Adding or changing things

- **A new field on a stored host:** add it to `HostEntry`. Keep `isHostEntry()` accepting entries that
  lack it, or existing lists will be dropped.
- **A new cross-world message:** add the type and a guard to `messages.ts`, then use the guard on the
  receiving side.
