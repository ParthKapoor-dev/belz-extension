# `tests/e2e/`

End-to-end check of the built, packaged extension in real headless browsers: Chromium over the DevTools protocol (CDP) and Firefox over WebDriver BiDi. It proves what unit tests cannot, because it runs the shipped files: minified, code-split, with the IDE loaded lazily. It is not part of `bun test`, and CI does not run it.

## Contents

| File | What it does |
|---|---|
| [`run.mjs`](run.mjs) | The runner: builds, prepares a test copy of each browser's tree, serves the page, drives each browser, and compares the page's report with `EXPECTED`. |
| [`page.html`](page.html) | The scenario page. It carries minimal AD markup, drives itself once the content script is in, and writes a JSON report to `<html data-e2e="...">`. |

## How it works

1. **Build.** `run.mjs` runs `node scripts/pack.mjs` unless given `--no-build`.
2. **Serve.** A Node HTTP server on `127.0.0.1` (random port) serves `page.html` at `/automation-designer/e2e.html`, so it matches the AD content script's path.
3. **Prepare the extension.** For each browser, `prepareExtension()` copies `build/chrome` or `build/firefox` to a temp directory and changes only its `manifest.json`: `host_permissions` for the local origin, a static `content_scripts` entry loading `dist/ad-content.js` on `<origin>/automation-designer/*`, the local origin added to `web_accessible_resources`, and for Firefox a test gecko id (`belz-e2e@test`). The real extension registers content scripts at runtime after a user grant, which a headless browser cannot give. Every script file stays the shipped one.
4. **Drive the browser.**
   - Chromium: started with `--headless=new`, `--load-extension` and `--remote-debugging-port=0`. The runner reads the port from the `DevTools listening on` line, opens the page with `/json/new`, and polls the report with `Runtime.evaluate`.
   - Firefox: started with `-headless` and `--remote-debugging-port 0` on a fresh profile. The runner reads the `WebDriver BiDi listening on` URL, opens a session, installs the extension with `webExtension.install`, navigates, and polls with `script.evaluate`.
   - Both use `rpc()`, a small JSON-RPC-over-WebSocket client. The report is polled every 250 ms for up to 30 s.
5. **Compare.** Each key of the report must equal `EXPECTED`; a `report.error` also fails. The browser is killed, and the temp directory and server are cleaned up.

## What it checks

The page (`page.html`) waits past the overlay's first re-arm, then records:

| Report key | Expected | Meaning |
|---|---|---|
| `contentScriptRan` | `true` | `Ctrl+Shift+Enter` clicked Run Test, so the content script is running. |
| `ideBeforeClick` | `false` | No `.cm-editor` before the IDE is opened: it is lazily loaded. |
| `overlayShown` | `true` | Hovering the textarea shows the shared overlay and its launcher. |
| `ideOpened`, `contentMatches` | `true` | Clicking the launcher loads the IDE chunk and opens it with the textarea's text. |
| `detected` | `'sql'` | The IDE detected SQL (the text is SQL containing `#{userId}`). |
| `variableStatus` | `'Outside steps · 2 variables in scope'` | The AD variable scanner ran on open and found the input and the step output. |
| `runTestWhileIdeOpen` | `0` | With the IDE open, `Ctrl+Shift+Enter` does nothing: the lazy IDE and the eager shortcut share one modal lock. |
| `ideClosed`, `runTestAfterClose` | `true`, `1` | `Esc` closes the IDE, after which the shortcut works again. |
| `publishedOverlay` | `true` | The overlay also appears over a `disabled` (published) textarea, whose hover the browser retargets to its parent. |

## Prerequisites

- Node.js 22 or newer, for the global `WebSocket` the runner uses without an import, and Bun for the build.
- Chromium: found on `PATH` as `chromium`, `chromium-browser` or `google-chrome`, or set `CHROMIUM_BIN`.
- Firefox: found on `PATH` as `firefox`, or set `FIREFOX_BIN`. The installed Firefox must support `webExtension.install` over BiDi.
- A browser that is not found is reported as skipped, not failed.

## Running

The `test:e2e` script in `package.json` runs `node tests/e2e/run.mjs`. Options:

- `--no-build` reuses the existing `build/` trees.
- `--only chromium` or `--only firefox` runs one browser.

The output is one line per browser: passed with the number of checks, skipped, or failed with each mismatch.

## Conventions

- Match patterns in the patched manifest carry no port. Firefox rejects a pattern with one, and a port-less pattern matches every port.
- The page reads the extension's own element ids (`#belzTextareaControls`, `.belzTextareaLauncher`, `#belzIdeLanguage`, `#belzIdeStatus`, `#belzIdeOverlay`). Renaming one in `src/` means updating `page.html`.

## Adding or changing things

**A new check:**

1. In `page.html`, add a step to the async block that sets a new key on `r`.
2. Add the key and its expected value to `EXPECTED` in `run.mjs`.
3. If the check needs more host-page markup, add only what the code reads.
