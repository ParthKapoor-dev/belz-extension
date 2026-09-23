# `tests/`

The extension's tests. Unit tests run under `bun test` against the source in `src/`, with a simulated DOM (happy-dom) and an in-memory `chrome` API. The end-to-end suite in [`e2e/`](e2e/) runs the built extension in real headless browsers.

## Contents

| File / directory | What it does |
|---|---|
| [`setup.ts`](setup.ts) | Preloaded before every test file: starts the memory guard, installs happy-dom and the fake `chrome`. |
| [`memory-guard-worker.ts`](memory-guard-worker.ts) | Worker thread that kills the test process if its memory passes a limit. |
| [`tsconfig.json`](tsconfig.json) | Type-check config for the tests: extends the root one, adds Bun and `chrome` types. |
| [`wait.ts`](wait.ts) | Waiting helpers: `nextTask()`, `sleep()` and `waitFor(condition, what, timeoutMs)`. |
| [`fakes/`](fakes/) | The in-memory `chrome` API. |
| [`fixtures/`](fixtures/) | Minimal Automation Designer markup for DOM-reading tests. |
| [`background/`](background/) | Tests for `src/background/`: content-script registration and seeding, the message relay and the browser commands. |
| [`build/`](build/) | Checks the build: the real bundle output, and the per-browser manifests. |
| [`config/`](config/) | Tests for `src/config/`: the settings schema. |
| [`designer/`](designer/) | Tests for `src/designer/`: core, features and UI. |
| [`devtools/`](devtools/) | Tests for `src/devtools/`: both panels, their helpers, and `PanelRegistrar`. |
| [`docs/`](docs/) | Checks every directory has a `README.md` and that relative links in READMEs and `AGENTS.md` resolve. |
| [`e2e/`](e2e/) | End-to-end run of the packaged extension in Chromium and Firefox. Not part of `bun test`. |
| [`options/`](options/) | Tests for `src/options/`: the options page over its real markup. |
| [`pd-inspector-page/`](pd-inspector-page/) | Tests for `src/pd-inspector-page/`: config fetching, trees, the resolver, and the `PdEngine` / `Highlighter` lifecycle. |
| [`shared/`](shared/) | Tests for `src/shared/`: host list, logger and rich links. |

## How it works

1. [`bunfig.toml`](../bunfig.toml) sets `root = "./tests"` (so `bun test` only looks here) and `preload = ["./tests/setup.ts"]`.
2. `setup.ts` runs before any test file imports source, because several source modules touch `document` or `chrome` at import time. It:
   - starts `memory-guard-worker.ts` in a `Worker` and `unref()`s it, so the run can exit while it is alive;
   - calls `GlobalRegistrator.register()` from `@happy-dom/global-registrator` with the URL `https://designer.test/automation-designer/Cat/abc`, which gives every test `window`, `document` and the other DOM globals;
   - sets `globalThis.chrome` to `fakeChrome` from [`fakes/chrome.ts`](fakes/chrome.ts).
3. Every test file shares that one DOM and one fake. Tests that depend on state reset it themselves: `fakeChrome.reset()` in a `beforeEach`, `document.body.innerHTML = ...` to render markup.

**Unit vs end-to-end.** Unit tests import source modules directly; the whole run takes a few seconds, most of it [`build/bundle.test.ts`](build/bundle.test.ts), which runs the real build and so rewrites `dist/`. They cannot catch problems that only exist in the built output (minification, code-splitting, lazy loading, manifest rules). [`build/`](build/) covers some of that by inspecting the build output. [`e2e/`](e2e/) covers the rest by loading the packaged extension in real browsers.

## Conventions

- **Layout mirrors `src/`.** A test for `src/<area>/<file>.ts` goes in `tests/<area>/`. Tests import source with relative paths (`../../src/...`).
- **Never pass a value that holds DOM nodes to `expect()`.** When such an assertion fails, bun's failure printer walks the whole happy-dom object graph and allocates without limit. It has reached about 10 GB and been killed by the kernel's out-of-memory killer, taking the terminal with it. Compare plain fields, or compare identities with `expect(a === b).toBe(true)`. Several files map DOM-holding results to plain summaries first (see `summary()` in [`designer/features/json-editor.test.ts`](designer/features/json-editor.test.ts)).
- **The memory guard is a backstop, not a fix.** `memory-guard-worker.ts` checks the process RSS every 200 ms and sends `SIGKILL` once it passes 1024 MB, printing the likely cause. It runs on its own thread because the runaway printing is synchronous: the main thread never returns to its event loop, so a timer there would never fire. Set `BELZ_TEST_MEMORY_LIMIT_MB` to change the limit.
- **Stop what you start.** A test that starts a class with timers or listeners calls `stop()` in `afterEach`/`afterAll`, so nothing outlives the file. `bootstrap()` returns a teardown for the same purpose.
- **Wait on a condition, not a guess.** Use `waitFor()` from [`wait.ts`](wait.ts) until the expected state holds; it returns as soon as it does and has a generous timeout. `nextTask()` lets queued timers run, which includes the fake's `storage.onChanged`. A fixed `sleep()` is only for showing that something does *not* happen, with a wide margin. bun's fake timers cannot advance time in the Bun version used, so they are not used.
- **Restore globals you replace.** Tests that stub `globalThis.fetch` keep the real one and put it back in `afterEach`/`afterAll`.
- Repo-wide testing rules are in [AGENTS.md](../AGENTS.md) ("Testing").

## Testing

`package.json` scripts:

- `test` runs `bun test` (everything here except `e2e/`).
- `test:e2e` runs `node tests/e2e/run.mjs`.
- `typecheck` also type-checks this folder through [`tsconfig.json`](tsconfig.json).

See the root [README.md](../README.md) Development section for how to run them.

## Adding or changing things

**A new unit test:**

1. Put it in the folder matching the source file's folder under `src/`. Create the folder (with a `README.md`) if it does not exist yet.
2. Name it `<topic>.test.ts` and import from `bun:test`.
3. Use `fakeChrome` from [`fakes/chrome.ts`](fakes/chrome.ts) for extension APIs. If the code needs a `chrome.*` API the fake lacks, add it there.
4. Assert on plain values only.
5. Wait with `waitFor()` from [`wait.ts`](wait.ts), not a fixed sleep.
