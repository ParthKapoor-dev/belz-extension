# belz-extension

A browser extension that augments Service Designer's web UI — Automation Designer (AD), Page Designer (PD), and the DevTools layer — with productivity helpers for engineers who live in these tools.

## What it does

### Automation Designer

- **Title updater** — appends the current method name to the page title (`Service Designer — vin.lookup`) so the tab is identifiable at a glance.
- **Run Test shortcut** — `Ctrl + Shift + Enter` triggers the Run Test button from anywhere on the page, including inside inputs and textareas.
- **JSON input editor** — `📋 JSON` button on each method opens a CodeMirror modal that edits every input as one JSON document, syncs back into the per-input controls with type-aware handling (Text, Number, Boolean, Date, JSON, Array, Map, StructuredData).
- **Output copy** — hover-revealed copy icon on each output container.
- **Textarea editor** — hover-revealed Open + Copy icons on native textareas. Open launches a CodeMirror modal with line numbers, auto-syntax (SQL / SpEL / JS / JSON / plain), wrap/no-wrap, and font controls.
- **Settings** — `Ctrl + ,` (or the gear icon near the page title) opens the settings modal to toggle features and persist textarea editor defaults.

### Page Designer

- **Page title updater** mirrors the AD behavior for ui-designer pages.
- **PD inspector** — hover-revealed control to dump the deployable page config and walk component nesting.

### DevTools panel

- Adds a panel that lists every `/rest/api/automation/chain/...` call observed on the page, with request/response inspection, search, and an Execute action that replays a chain with edited inputs.

## Install

### Force-installed builds (recommended)

Signed CRX (Chrome / Edge / Brave / Zen-Chromium) and signed XPI (Firefox / Zen-Firefox) builds are published from each `v*` tag to this repo's GitHub Releases. The update manifests live at:

- Chrome: `https://parthkapoor-dev.github.io/belz-extension/updates.xml`
- Firefox: `https://parthkapoor-dev.github.io/belz-extension/updates.json`

Add an `ExtensionInstallForcelist` policy entry on Chromium, or an `ExtensionSettings` entry on Firefox, pointing at the URLs above. The extension auto-updates on the next browser-internal poll whenever a new `v*` tag ships.

### Load unpacked (development)

```bash
git clone https://github.com/ParthKapoor-dev/belz-extension.git
cd belz-extension
bun install
bun run build
```

Then in your browser:

- **Chromium**: open `chrome://extensions`, enable Developer mode, click "Load unpacked", select this repo's root.
- **Firefox**: open `about:debugging` → This Firefox → "Load Temporary Add-on", select `manifest.json`.

## Build

| Command | What it does |
|---|---|
| `bun install` | install dependencies |
| `bun run build` | bundle every entry point into `dist/` and escape non-ASCII for the extension loader |
| `bun run dev` | watch-mode rebuild of content scripts + the DevTools panel |
| `node scripts/pack.mjs` | assemble per-browser unpacked trees in `build/chrome` and `build/firefox` |

## Release

Push a tag matching `v*` (e.g. `v1.1.0`). The `release.yml` workflow:

1. Builds per-browser trees with `scripts/pack.mjs`.
2. Signs a Chromium CRX (deterministic ID derived from the `CHROME_CRX_KEY` secret).
3. Signs a Firefox XPI via the Mozilla AMO API (`AMO_JWT_*` secrets).
4. Generates `updates.xml` (Chrome) and `updates.json` (Firefox).
5. Attaches the CRX + XPI to the GitHub Release and publishes the update manifests to GitHub Pages.

Required repo secrets:

- `CHROME_CRX_KEY` — PEM private key for CRX signing. Generate once with `openssl genrsa 2048 > key.pem` and **never rotate** (it pins the Chrome extension ID).
- `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` — Mozilla add-ons API credentials.

One-time setup: enable GitHub Pages (Settings → Pages → source: GitHub Actions). After the first release, copy the printed Chrome extension ID into `release.config.json` (`chromeId`) so subsequent updates resolve cleanly.

## Layout

```
src/
  ad-content.js          AD page content script (entry)
  pd-content.js          PD page content script (entry)
  pd-inspector.js        PD inspector content script (entry)
  background.js          MV3 service worker / Firefox background scripts
  devtools/              DevTools page + panels (AD chain + PD inspector)
  features/              feature modules (title, keyboard, json-editor, …)
  core/                  bootstrap, settings, state, logger, observer
  ui/                    modal, toast, modal-lock, theme tokens
  utils/                 dom + clipboard helpers
scripts/
  build.mjs              bundles each entry point with bun build
  escape-non-ascii.mjs   post-bundle pass for loader compatibility
  pack.mjs               assembles per-browser unpacked trees
manifest.json            MV3 manifest
release.config.json      extension identity (firefox id, chrome update URL)
```

## License

MIT. See [`LICENSE`](./LICENSE).
