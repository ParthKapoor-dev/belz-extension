# `tests/shared/`

Unit tests for helpers in [`src/shared/`](../../src/shared/) that every JavaScript world of the extension uses.

## Contents

| File | Source under test | What it covers |
|---|---|---|
| [`hosts.test.ts`](hosts.test.ts) | [`hosts.ts`](../../src/shared/hosts.ts) | `normalizeHost()` accepts hostnames and URLs (strips scheme, port, path, case) and rejects invalid names. `readHosts()` returns nothing from empty or malformed storage and drops entries without a string `host` and a boolean `enabled`, keeping order. `readEnabledHosts()`, `isHostsChange()` (host key in `local` only), and `originPattern()` (https only). |
| [`logger.test.ts`](logger.test.ts) | [`logger.ts`](../../src/shared/logger.ts) | `createLogger()`: `warn` and `error` always print with the `[belz:<scope>]` prefix; `debug` and `info` print only while the `debugLogging` setting is on. Also a repo-wide rule: no file in `src/` other than `shared/logger.ts` may call `console.*`. |

## How it works

- `hosts.test.ts` writes to `fakeChrome.storage.local` directly (see [`../fakes/`](../fakes/)) and calls `fakeChrome.reset()` before each test.
- `logger.test.ts` spies on the `console` methods and toggles Debug Logging by writing the settings key to storage. The logger follows that setting through `storage.onChanged`, which the fake fires synchronously.
- The `console` rule scans every `.ts` file under `src/` for `console.<method>(`.

## Conventions

If the `console` rule fails, route the output through `createLogger(scope)` instead. See [AGENTS.md](../../AGENTS.md) ("Logging").
