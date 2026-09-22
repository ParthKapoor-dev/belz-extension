# belz-extension

A browser extension for engineers working in Service Designer. It adds productivity tools to **Automation Designer (AD)** and **Page Designer (PD)**, plus two **DevTools panels**: one for tracing AD method calls, and one for finding which PD component rendered a given part of a page.

It runs on Chrome, Edge, Brave, Firefox and Zen. It only talks to the sites you add yourself, and it collects nothing.

## Contents

- [Install](#install)
- [First-time setup](#first-time-setup)
- [Using it](#using-it)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Privacy and permissions](#privacy-and-permissions)

---

## Install

There are no published builds yet, so you build it from source. It takes about a minute.

**You need:** [Git](https://git-scm.com/), [Bun](https://bun.sh/), and [Node.js](https://nodejs.org/) 18 or newer.

```bash
git clone https://github.com/ParthKapoor-dev/belz-extension.git
cd belz-extension
bun install
bun run build
```

That creates a ready-to-load extension for each browser family under `build/`. Load the one for your browser:

**Chrome, Edge, Brave**

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the **`build/chrome`** folder.

**Firefox, Zen**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**
3. Choose **`build/firefox/manifest.json`**.

> Firefox removes temporary add-ons when it closes, so you'll repeat these three steps after each restart. That's a Firefox rule for unsigned extensions, not a bug.

> **Load from `build/`, never from the repo root.** The root `manifest.json` is a template that the build splits per browser. It will not load in Firefox.

---

## First-time setup

**The extension does nothing until you tell it which sites to work on.** It ships without access to any website, so there's one step before anything appears.

1. **Open the extension's settings page.**
   - Chrome/Edge/Brave: `chrome://extensions` → **belz DevTools** → **Details** → **Extension options**
   - Firefox/Zen: `about:addons` → **belz DevTools** → **Preferences**
2. Under **Allowed sites**, type the hostname of your Service Designer instance (only the hostname, like `your-instance.example.com`) and click **Add**.
3. **Approve the browser's permission prompt.** Without it, the extension can't run on that site.
4. **Reload any tabs** you already had open on that site.

Repeat for each environment you use (dev, QA, and so on). To remove access, click **Revoke**, which removes the site and its permission.

**Optional: designer host.** Some deployments serve the Automation Designer on a different host from the one you browse, such as a public portal plus a staff portal. If yours does, fill in **designer host** for that site so the **Open** links go to the right place. Most setups can leave it blank.

---

## Using it

### In Automation Designer

| Feature | How to use it |
|---|---|
| **Large text editor** | Hover over any text box and click **⤢** (top-right corner). Opens a full-screen editor with line numbers, search (`Ctrl+F`) and syntax highlighting. It detects the language automatically: SQL, SpEL, JavaScript, JSON, Java, Python or plain text. `Ctrl+S` saves the text back into the box. On published methods, the editor opens read-only. |
| **Copy a text box** | Hover over a text box and click **⧉**. |
| **Edit inputs as JSON** | Click the **JSON** button next to a method's **Inputs** heading, or press `Shift+J`. Edit every input as one JSON document. Your changes go back into each input field with the correct type, including dates, booleans and structured data. |
| **Copy an output** | Hover over an output and click **⧉**. |
| **Run Test from anywhere** | `Ctrl+Shift+Enter`, even while you're typing in a field. It saves the field first, so the test uses your latest edit. |
| **Copy a link to the method** | `Shift+L` copies a link labelled `category::method`. It pastes as a clickable link in Slack and docs. |
| **Readable tab titles** | Tabs show `AD: <method name>` rather than a generic title. |

### In Page Designer

The tab title updates to `PD: <page name>`, and the text-editor, copy and settings tools work the same as in Automation Designer.

### DevTools: AD Network

Open DevTools (`F12`) on an allowed site and select the **AD Network** tab. It lists every Automation Designer method call the page makes, in order, with each method's **name and category**. The regular Network tab only shows IDs.

- **Click a row** to see its headers, request payload, response and timing.
- **Actions** on each row: **copy as cURL**, **copy a Slack link**, and **Open**. **Open** opens the method in the designer, and if the request sent inputs, fills them in.
- Requests still in progress show as **pending**, and cancelled ones show a red **canceled** label.
- Use **Filter** to search by name, UUID or URL. Tick **Preserve log** to keep entries when the page navigates.

Requests made before you opened the tab are still listed.

### DevTools: PD Inspector

Open a **published** page (a `/pages/...` URL) on an allowed site, open DevTools and select the **PD Inspector** tab.

- The panel shows the page's **component tree**, including the navbar and sidebar the page is placed inside.
- Click **Inspect**, then point at anything on the page to see **which PD component rendered it** and where that component sits in the tree. Click to select it.
- Click a component in the tree to **highlight** it on the page.
- **Refresh** reloads the page's configuration after a redeploy.

### Settings

Click the **⚙** button next to the page title in AD or PD, or press `Alt+Shift+S`. Here you can switch any feature on or off and set the editor's default font size and line wrapping. Changes apply immediately and are shared across all your sites.

---

## Keyboard shortcuts

| Shortcut | Does | Where |
|---|---|---|
| `Ctrl+Shift+Enter` | Run Test | AD |
| `Shift+J` | Open the JSON input editor | AD |
| `Shift+L` | Copy a link to this method | AD |
| `Esc` `Esc` | Leave the current field (so your edit registers) | AD, PD |
| `Alt+Shift+S` | Open settings | AD, PD |
| `Ctrl+,` or `Alt+,` | Open settings (`Ctrl+,` is taken by Firefox and Zen) | AD, PD |
| `Ctrl+S` / `Ctrl+F` / `Esc` | Save / search / close | Large editor |
| `Ctrl+Shift+A` | Jump to the newest entry in AD Network | DevTools open |
| `Ctrl+Shift+P` | Refresh PD Inspector | DevTools open |

`Alt+Shift+S`, `Ctrl+Shift+A` and `Ctrl+Shift+P` are browser-level shortcuts, and you can change them at `chrome://extensions/shortcuts`. In Firefox, go to `about:addons` → ⚙ → **Manage Extension Shortcuts**. Browsers don't let extensions open DevTools, so `Ctrl+Shift+A` and `Ctrl+Shift+P` only work while DevTools is open on the right tab.

---

## Troubleshooting

**Nothing appears on the page.** Check that the site is in **Allowed sites** and shows **Revoke**. If it shows **Grant** or `not granted`, click **Grant**. Then reload the tab.

**The DevTools tabs are missing.** They only appear on allowed sites. Close and reopen DevTools after adding a site.

**AD Network shows `(resolving…)` instead of names.** Method names are looked up using your existing login, so sign in to the site. The panel retries by itself.

**The extension disappeared in Firefox.** Temporary add-ons are removed when Firefox closes. Load it again (see [Install](#install)).

**A feature stopped working after an upstream UI change.** The extension relies on the AD/PD page structure, so that's the likeliest cause. Please [open an issue](https://github.com/ParthKapoor-dev/belz-extension/issues).

---

## Development

| Command | What it does |
|---|---|
| `bun install` | Install dependencies |
| `bun run build` | Bundle everything and assemble `build/chrome` + `build/firefox`. The only command you normally need. |
| `bun run build:dist` | Bundle to `dist/` only, without the per-browser folders |
| `bun run dev` | Rebuild `build/chrome` + `build/firefox` every time you save a file |
| `bun test` | Run the unit tests (about a second) |
| `bun run test:e2e` | Run the built extension in headless Chromium and Firefox, if installed |

**The edit loop:** run `bun run dev` and leave it running. After each save, click the extension's **reload** icon (`chrome://extensions`, or **Reload** in `about:debugging`), then reload the page. Reloading keeps your sites and permissions, but removing and re-adding the extension clears them.

**Keeping your sites across reinstalls.** Browsers delete an extension's data when it's removed, and so does Firefox's temporary-add-on reload. To avoid retyping your sites, copy `sites.default.json.example` to `sites.default.json` and list them there:

```json
{ "hosts": [ { "host": "your-instance.example.com", "designerHost": "" } ] }
```

On a fresh install they're restored automatically. You still need to click **Grant** once for each, because only you can approve a site permission. The file is gitignored so that your internal hostnames stay out of the repository.

**How it works.** Start with [`AGENTS.md`](./AGENTS.md), the maintained map of the codebase. Each top-level folder of `src/` is one part of the extension, and they run separately from each other:

```
src/
  designer/       content scripts on Automation Designer and Page Designer pages
  pd-inspector/   the PD Inspector engine, on published pages
  devtools/       the AD Network and PD Inspector DevTools panels
  background/     site registration, shortcuts, message relay
  options/        the Allowed sites page
  config/         constants shared by all of the above
  shared/         helpers shared by all of the above
tests/            unit tests (mirroring src/), e2e/ for real browsers
scripts/          build, per-browser packaging, dev watcher
```

### Releasing

A release hasn't been published yet, but the pipeline is in place. Pushing a `v*` tag runs `.github/workflows/release.yml`, which does three things:

- Builds and signs a Chrome `.crx` and a Firefox `.xpi`.
- Attaches both to a GitHub Release.
- Publishes auto-update manifests to GitHub Pages.

Once a release exists, browsers can install the extension by policy and keep it updated automatically.

Before the first tag, you need to:

- Add the repo secrets: `CHROME_CRX_KEY` (make it once with `openssl genrsa 2048 > key.pem` and **never rotate it**, because it fixes the Chrome extension ID), plus `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` for Mozilla signing.
- Enable GitHub Pages (Settings → Pages → Source: GitHub Actions).
- After the first release, copy the printed Chrome extension ID into `chromeId` in `release.config.json`.

---

## Privacy and permissions

- **Talks only to the sites you add.** No analytics, no telemetry, and no companion server. Method names and page configurations come from the site you're on, using your existing login.
- **No website access by default.** Each site needs your explicit approval in a browser prompt, and you can revoke it at any time.
- **Permissions requested:** `storage` (your settings and site list), `scripting` (to run on your approved sites), and `activeTab`.

## License

MIT. See [`LICENSE`](./LICENSE).
