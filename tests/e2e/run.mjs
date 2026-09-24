// End-to-end check of the REAL packaged extension in real browsers.
//
// Unit tests (bun test) run the source against a simulated DOM. This runs the
// built extension — minified, code-split, lazily loaded — inside headless
// Chromium and Firefox, on tests/e2e/page.html, and checks what a user would
// see. It is what proves, for example, that the lazily loaded IDE and the
// eagerly loaded shortcut really share one modal lock in a browser.
//
// How: builds, copies build/chrome and build/firefox to a temp directory and
// changes only their manifests — a static content script on a local test page
// (the real extension registers scripts at runtime after a user grant, which a
// headless browser cannot give) and access to 127.0.0.1. Every script file is
// the shipped one. Chromium is driven over the DevTools protocol, Firefox over
// WebDriver BiDi; both in real time.
//
// usage: bun run test:e2e [--no-build] [--only chromium|firefox]
// Browsers: found on PATH, or set CHROMIUM_BIN / FIREFOX_BIN. A browser that is
// not installed is reported as skipped.
import { execSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const RESULT_TIMEOUT_MS = 30_000;

/** What the scenario page must report. */
const EXPECTED = {
  contentScriptRan: true,
  ideBeforeClick: false,
  overlayShown: true,
  ideOpened: true,
  contentMatches: true,
  detected: 'sql',
  variableStatus: 'Outside steps · 2 variables in scope',
  runTestWhileIdeOpen: 0,
  // .cm-content's text: one line per element, so no newlines between them.
  formatted: "SELECT  idFROM  guardianWHERE  account_id = '#{userId}'",
  formatKeyReachedPage: false,
  ideClosed: true,
  runTestAfterClose: 1,
  publishedOverlay: true,
  vimWhileOff: false,
  vimChunkLoaded: true,
  vimNormal: true,
  vimInsert: true,
  vimEscToNormal: true,
  vimEscClosed: true
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBinary(envVar, names) {
  if (process.env[envVar]) return process.env[envVar];
  for (const name of names) {
    try {
      return execSync(`command -v ${name}`, { encoding: 'utf8', shell: '/bin/sh' }).trim();
    } catch {
      /* try the next name */
    }
  }
  return null;
}

// ---- test copies of the packaged extension --------------------------------
function prepareExtension(tmp, browser, origin) {
  // Match patterns cannot carry a port (Firefox rejects the whole pattern), and
  // a port-less pattern matches every port.
  origin = origin.replace(/:\d+$/, '');
  const dest = path.join(tmp, `ext-${browser}`);
  cpSync(path.join(root, 'build', browser), dest, { recursive: true });
  const manifestPath = path.join(dest, 'manifest.json');
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  m.host_permissions = [`${origin}/*`];
  m.content_scripts = [{
    matches: [`${origin}/automation-designer/*`],
    js: ['dist/ad-content.js'],
    run_at: 'document_idle'
  }];
  for (const war of m.web_accessible_resources) war.matches.push(`${origin}/*`);
  if (browser === 'firefox') m.browser_specific_settings = { gecko: { id: 'belz-e2e@test' } };
  writeFileSync(manifestPath, JSON.stringify(m, null, 2));
  return dest;
}

// ---- the scenario page -----------------------------------------------------
function servePage() {
  const html = readFileSync(path.join(root, 'tests/e2e/page.html'));
  const server = createServer((req, res) => {
    if (req.url.startsWith('/automation-designer/e2e.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Resolve with the first stderr/stdout line matching `re`. */
function waitForLine(child, re, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: no startup line`)), 20_000);
    const onData = (buf) => {
      const m = String(buf).match(re);
      if (m) {
        clearTimeout(timer);
        resolve(m);
      }
    };
    child.stderr.on('data', onData);
    child.stdout.on('data', onData);
    child.on('exit', (code) => reject(new Error(`${what} exited (${code}) during startup`)));
  });
}

/** A minimal JSON-RPC-over-WebSocket client (CDP and BiDi share the shape). */
async function rpc(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)} ${msg.message || ''}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return { send, close: () => ws.close() };
}

/** Poll `read()` until it yields the report attribute. */
async function pollReport(read) {
  const end = Date.now() + RESULT_TIMEOUT_MS;
  while (Date.now() < end) {
    const value = await read();
    if (value) return JSON.parse(value);
    await sleep(250);
  }
  throw new Error('the scenario page never reported (content script did not run?)');
}

const REPORT_EXPR = 'document.documentElement.getAttribute("data-e2e")';

// ---- Chromium over the DevTools protocol ----------------------------------
async function runChromium(bin, extDir, url, tmp) {
  const browser = spawn(bin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${path.join(tmp, 'chromium-profile')}`,
    '--remote-debugging-port=0',
    `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const [, port] = await waitForLine(browser, /DevTools listening on ws:\/\/[^:]+:(\d+)\//, 'chromium');
    await sleep(1500); // let the extension's service worker come up
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(url)}`, { method: 'PUT' })).json();
    const cdp = await rpc(target.webSocketDebuggerUrl);
    try {
      return await pollReport(async () => {
        const res = await cdp.send('Runtime.evaluate', { expression: REPORT_EXPR, returnByValue: true });
        return res.result && res.result.value;
      });
    } finally {
      cdp.close();
    }
  } finally {
    browser.kill('SIGKILL');
  }
}

// ---- Firefox over WebDriver BiDi -------------------------------------------
async function runFirefox(bin, extDir, url, tmp) {
  const profile = path.join(tmp, 'firefox-profile');
  mkdirSync(profile); // Firefox will not create it
  const browser = spawn(bin, [
    '-headless', '-no-remote', '-profile', profile, '--remote-debugging-port', '0'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const [, wsUrl] = await waitForLine(browser, /WebDriver BiDi listening on (ws:\/\/\S+)/, 'firefox');
    const bidi = await rpc(`${wsUrl.replace(/\/$/, '')}/session`);
    try {
      await bidi.send('session.new', { capabilities: {} });
      await bidi.send('webExtension.install', { extensionData: { type: 'path', path: extDir } });
      const tree = await bidi.send('browsingContext.getTree', {});
      const context = tree.contexts[0].context;
      await bidi.send('browsingContext.navigate', { context, url, wait: 'complete' });
      return await pollReport(async () => {
        const res = await bidi.send('script.evaluate', {
          expression: REPORT_EXPR, target: { context }, awaitPromise: false
        });
        return res.result && res.result.type === 'string' ? res.result.value : null;
      });
    } finally {
      bidi.close();
    }
  } finally {
    browser.kill('SIGKILL');
  }
}

// ---- main -------------------------------------------------------------------
function compare(report) {
  const failures = [];
  for (const [key, want] of Object.entries(EXPECTED)) {
    if (report[key] !== want) failures.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(report[key])}`);
  }
  if (report.error) failures.push(`page error: ${report.error}`);
  return failures;
}

if (!args.includes('--no-build')) {
  execSync('node scripts/pack.mjs', { cwd: root, stdio: 'inherit' });
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'belz-e2e-'));
const server = await servePage();
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/automation-designer/e2e.html`;

const browsers = [
  { name: 'chromium', build: 'chrome', bin: findBinary('CHROMIUM_BIN', ['chromium', 'chromium-browser', 'google-chrome']), run: runChromium },
  { name: 'firefox', build: 'firefox', bin: findBinary('FIREFOX_BIN', ['firefox']), run: runFirefox }
].filter((b) => !only || b.name === only);

let failed = false;
try {
  for (const b of browsers) {
    if (!b.bin) {
      console.log(`- ${b.name}: skipped (not installed)`);
      continue;
    }
    try {
      const report = await b.run(b.bin, prepareExtension(tmp, b.build, origin), url, tmp);
      const failures = compare(report);
      if (failures.length) {
        failed = true;
        console.log(`✗ ${b.name}\n    ${failures.join('\n    ')}`);
      } else {
        console.log(`✓ ${b.name}: ${Object.keys(EXPECTED).length} checks passed`);
      }
    } catch (err) {
      failed = true;
      console.log(`✗ ${b.name}: ${err.message}`);
    }
  }
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
