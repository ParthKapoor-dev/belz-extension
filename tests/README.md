# `tests/`

The extension's tests. Unit tests run under `bun test` against the source in `src/`, with a simulated DOM (happy-dom) and an in-memory `chrome` API. The end-to-end suite in [`e2e/`](e2e/) runs the built extension in real headless browsers. How to run them is in [`docs/development.md`](../docs/development.md); the repo-wide testing rules are in [AGENTS.md](../AGENTS.md) ("Testing").

## Contents

| File / directory | What it does |
|---|---|
| [`setup.ts`](setup.ts) | Preloaded before every test file: starts the memory guard, installs happy-dom and the fake `chrome`. |
| [`memory-guard-worker.ts`](memory-guard-worker.ts) | Worker thread that kills the test process if its memory passes a limit. |
| [`tsconfig.json`](tsconfig.json) | Type-check config for the tests: extends the root one, adds Bun and `chrome` types. |
| [`wait.ts`](wait.ts) | Waiting helpers: `nextTask()`, `sleep()` and `waitFor(condition, what, timeoutMs)`. |
| [`fakes/chrome.ts`](fakes/chrome.ts) | The in-memory `chrome` API (`fakeChrome`), plus ready-made message senders: `extensionPageSender`, `optionsPageSender`, `contentScriptSender(url, tabId)`. |
| [`fixtures/`](fixtures/) | Minimal Automation Designer markup for DOM-reading tests: the Inputs step (`ad-inputs.ts`) and the `#{variable}` scope (`ad-scope.ts`). |
| [`background/`](background/), [`config/`](config/), [`designer/`](designer/), [`devtools/`](devtools/), [`options/`](options/), [`pd-inspector-page/`](pd-inspector-page/), [`shared/`](shared/) | Unit tests for the matching folder of `src/`. |
| [`build/`](build/) | Checks the build: `bundle.test.ts` runs the real build and inspects `dist/modules/`; `manifest.test.ts` checks the per-browser manifests without building. |
| [`docs/`](docs/) | Checks that every folder under `src/` and every top-level folder has a `README.md`, and that relative links in the docs resolve. |
| [`e2e/`](e2e/) | End-to-end run of the packaged extension in Chromium and Firefox. Not part of `bun test`. |

## How it works

1. [`bunfig.toml`](../bunfig.toml) sets `root = "./tests"` (so `bun test` only looks here) and `preload = ["./tests/setup.ts"]`.
2. `setup.ts` runs before any test file imports source, because several source modules touch `document` or `chrome` at import time. It starts `memory-guard-worker.ts` in an `unref()`'d `Worker`, registers happy-dom at `https://designer.test/automation-designer/Cat/abc`, and sets `globalThis.chrome` to `fakeChrome`.
3. Every test file shares that one DOM and one fake. Tests that depend on state reset it themselves: `fakeChrome.reset()` in a `beforeEach`, `document.body.innerHTML = ...` to render markup.

**The fake `chrome`** behaves like the browser where the code depends on it: `storage.onChanged` fires a task after the write and only for values that changed; `registerContentScripts` is all-or-nothing and rejects a duplicate id; `runtime.sendMessage`, `tabs.sendMessage`, `permissions.request` and `devtools.inspectedWindow.eval` record what they were given and answer through hooks a test sets (`runtime.respond`, `tabs.respond`, `permissions.allowRequest`, `inspectedWindow.evalHandler`). `reset()` clears data and hooks but keeps listeners, which source modules may have added at import time. When code starts using a new `chrome.*` call, add it to the fake, matching the real API where the code depends on it.

**Build checks** (`build/bundle.test.ts`) walk the static-import closure of `dist/modules/ad-content.js` and `pd-content.js` and fail if the IDE, the formatter or Vim mode is loaded with the page, if that closure passes 100 KB, or if the JSON editor or the variable scanner reaches the PD bundle. The markers they look for are constants at the top of the file; rename one in `src/` and update it there. The test rebuilds `dist/`.

**End-to-end** (`e2e/run.mjs`): builds (unless `--no-build`), copies `build/chrome` and `build/firefox` to a temp directory and patches only their manifests (a static content script on a local page served from `127.0.0.1`, without a port in the match patterns, which Firefox rejects), then drives headless Chromium over the DevTools protocol and Firefox over WebDriver BiDi. [`e2e/page.html`](e2e/page.html) drives itself and writes a JSON report; each key must equal `EXPECTED` in `run.mjs`. To add a check, set a new key in the page's script and add it to `EXPECTED`. It needs Node.js 22 or newer; Chromium is found as `chromium`, `chromium-browser` or `google-chrome` (or `CHROMIUM_BIN`), Firefox as `firefox` (or `FIREFOX_BIN`), and a missing browser is skipped. `--only chromium` / `--only firefox` runs one. The page reads the extension's own element ids (`#belzTextareaControls`, `#belzIdeStatus`, …): renaming one in `src/` means updating `page.html`.

## Conventions

- **Layout mirrors `src/`.** A test for `src/<area>/<file>.ts` goes in `tests/<area>/`, named `<topic>.test.ts`, and imports source with relative paths.
- **Never pass a value that holds DOM nodes to `expect()`.** When such an assertion fails, bun's failure printer walks the whole happy-dom object graph and allocates without limit (it has reached about 10 GB). Compare plain fields, or identities with `expect(a === b).toBe(true)`.
- **The memory guard is a backstop, not a fix.** `memory-guard-worker.ts` checks the process RSS every 200 ms and sends `SIGKILL` past 1024 MB (`BELZ_TEST_MEMORY_LIMIT_MB` to change it). It runs on its own thread because the runaway printing is synchronous.
- **Stop what you start.** A test that starts a class with timers or listeners calls `stop()` in `afterEach`/`afterAll`; `bootstrap()` returns a teardown for the same purpose.
- **Wait on a condition, not a guess.** Use `waitFor()` until the expected state holds; `nextTask()` lets queued timers run, including the fake's `storage.onChanged`. A fixed `sleep()` is only for showing that something does *not* happen. bun's fake timers are not used.
- **Restore what you replace:** a stubbed `globalThis.fetch`, or a method on `fakeChrome`, is put back in `afterEach`/`finally`.
