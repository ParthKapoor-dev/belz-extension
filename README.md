# belz-extension

A browser extension for engineers working in Service Designer. It adds productivity tools to **Automation Designer (AD)** and **Page Designer (PD)**, plus two **DevTools panels**: one for tracing AD method calls, and one for finding which PD component rendered a given part of a page.

It runs on Chrome, Edge, Brave, Firefox and Zen. It only talks to the sites you add yourself, and it collects nothing.

## Contents

- [Install](#install)
- [First-time setup](#first-time-setup)
- [Using it](#using-it)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Releasing](#releasing)
- [Privacy and permissions](#privacy-and-permissions)
- [License](#license)

---

## Install

**Browsers:** Firefox 128 or newer (and Zen, which is built on it). On Chrome, Edge and Brave, use a current release; the extension sets no minimum Chrome version.

Signed builds are attached to the project's [GitHub Releases](https://github.com/ParthKapoor-dev/belz-extension/releases) when they are published. To build it yourself, which takes about a minute:

**You need:** [Git](https://git-scm.com/), [Bun](https://bun.sh/) (CI and the release build use Bun 1.2.20), and [Node.js](https://nodejs.org/) 18 or newer to build (20 or newer for `bun run dev` on Linux, which needs recursive file watching; 22 or newer for the end-to-end tests, which use Node's built-in `WebSocket`).

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

1. **Open the extension's options page** (titled **belz DevTools options**; it holds only the list of allowed sites).
   - Chrome/Edge/Brave: `chrome://extensions` → **belz DevTools** → **Details** → **Extension options**
   - Firefox/Zen: `about:addons` → **belz DevTools** → **Preferences**
2. Under **Allowed sites**, type the hostname of your Service Designer instance (only the hostname, like `your-instance.example.com`) and click **Add**. Only **https** sites can be added.
3. **Approve the browser's permission prompt.** Without it, the extension can't run on that site.
4. **Reload any tabs** you already had open on that site.

Repeat for each environment you use (dev, QA, and so on). To remove access, click **Revoke**, which removes the site and its permission.

**Optional: designer host.** Some deployments serve the Automation Designer on a different host from the one you browse, such as a public portal plus a staff portal. If yours does, fill in **designer host** for that site so the **Open** links go to the right place. For **Open** to also fill in the method's inputs, add the designer host as an allowed site of its own and grant it. Most setups can leave it blank.

---

## Using it

### In Automation Designer

| Feature | How to use it |
|---|---|
| **IDE** | Hover over any text box and click **⤢** (**Open in IDE**, top-right corner). The IDE opens full-screen for that text box, with line numbers, search (`Ctrl+F`) and syntax highlighting. On published methods, it opens read-only. See [IDE](#ide) below. |
| **`#{variable}` intellisense** | In the IDE, type `#{` to pick from the method's inputs, internal variables and step outputs. Hover a name to see where it comes from. Unknown names, outputs of steps that run later, and an unclosed `#{` are underlined. Variables are read from the page each time the IDE opens, so unsaved edits (a step you just added) are included. The footer shows the current step and how many variables it can use. |
| **Copy a text box** | Hover over a text box and click **⧉**. |
| **Edit inputs as JSON** | Click the **JSON** button next to a method's **Inputs** heading, or press `Shift+J`. Edit every input as one JSON document. **Sync** writes your changes back into each input field with the correct type, including dates, booleans and structured data. |
| **Copy an output** | Hover over a method's output and click **⧉**. |
| **Run Test from anywhere** | `Ctrl+Shift+Enter`, even while you're typing in a field. It commits the field first, so the test uses your latest edit. When the page shows no Run Test button, the key does nothing and is left to the page. |
| **Copy a link to the method** | `Shift+L` copies a link labelled `category::method`. It pastes as a clickable link in Slack and docs. |
| **Readable tab titles** | Tabs show `AD: <method name>` rather than a generic title. Turning the feature off puts the page's own title back. |

### In Page Designer

The tab title updates to `PD: <page name>`, and the IDE (with its **⧉** copy button on text boxes), `Esc` `Esc` and the Settings modal work the same as in Automation Designer. Page Designer has no Run Test, method link or JSON input editor, so `Ctrl+Shift+Enter`, `Shift+L` and `Shift+J` do nothing there and are left to the page. The output copy button and the `#{variable}` intellisense are AD-only.

### IDE

The IDE is a full-screen CodeMirror editor that opens for the page text box you clicked **⤢** on: language modes, autocomplete, hover help and checks.

- **Save:** `Ctrl+S` (`Command+S` on Mac) or **Save** writes the text back into the text box and closes the IDE.
- **Cancel** and **×** close without saving, and without asking.
- **Esc** or a **click outside** the IDE closes it. `Esc` first closes whatever CodeMirror has open: the autocomplete list or the search panel. If you changed the text, the first `Esc` or click outside only asks, in the footer; press `Esc` or click outside again within 3 seconds to discard your changes. Typing in between cancels the question.
- **Search:** `Ctrl+F` (`Command+F`) opens the search panel.
- The keys the IDE handles (`Ctrl/Command+S`, `Ctrl/Command+F`, `Esc`) are kept from the page and the browser: `Ctrl+S` never opens the browser's Save page dialog.
- **Autocomplete:** suggestions appear as you type (`Ctrl+Space` asks for them). `↑`/`↓` choose, `Enter` accepts, `Esc` closes the list.
- **Language:** detected from the text (SQL, SpEL, JavaScript, JSON, Java, Python or plain text). The language dropdown in the header overrides it for this editing session only.
- **Wrap and font size:** the two dropdowns next to it change the **IDE Wrap** and **IDE Font Size** settings, so the choice applies everywhere, not just to this text box.
- **⚙** opens the Settings modal over the IDE, and **Copy** copies the IDE's text.

### DevTools: AD Network

Open DevTools (`F12`) on an allowed site and select the **AD Network** tab. It lists every Automation Designer method call the page makes, in order, with each method's **name and category**. The regular Network tab only shows IDs.

- **Record** pauses and resumes capture. **Clear** empties the list. Tick **Preserve log** to keep entries when the page navigates.
- **Filter** searches by name, category, UUID or URL. The list keeps the newest 300 requests.
- **Click a row** to see its headers, request payload, response and timing. `↑`/`↓` move between rows. The detail pane's **Copy** copies what the open tab shows.
- **Click a UUID** to copy it.
- **Actions** on each row: **copy as cURL**, **copy a Slack link**, and **Open**. **Open** opens the method in the designer in a background tab, so you stay where you are; several clicks are queued and opened one after another. If the request sent inputs, the opened method's inputs are filled in with them (the designer host must be an allowed site).
- Requests still in progress show as **pending**, and cancelled ones show a red **canceled** label.

Requests made before you opened the tab are still listed. Names and categories are looked up on the same site with your existing sign-in; while they are unknown, a row shows the start of its UUID.

### DevTools: PD Inspector

Open a **published** page (a `/pages/...` URL) on an allowed site, open DevTools and select the **PD Inspector** tab.

- The panel shows the page's **component tree**, including the navbar and sidebar the page is placed inside.
- Click **Inspect**, then point at anything on the page to see **which PD component rendered it** and where that component sits in the tree. Click to select it. Inspect mode ends by itself when you close DevTools.
- Click a component in the tree to **highlight** it on the page.
- **↗ PD** on a component, and **↗ open in PD** in its detail, open that component (or the page) in Page Designer in a new tab.
- **Refresh** reloads the page's configuration after a redeploy.

---

## Settings

The **Settings modal** is on the AD and PD pages themselves (it is not the options page, which only holds the allowed sites). Open it with the **⚙** button next to the page title, the **⚙** in the IDE, `Alt+Shift+S`, or `Alt+,` (`Ctrl+,` works too where the browser does not keep it for itself; Firefox and Zen do). Changes apply immediately and are shared across all your sites.

| Setting | What it does | Default |
|---|---|---|
| **Title Updater** | Names the tab `AD: <method>` / `PD: <page>` | on |
| **Keyboard Shortcuts** | `Ctrl+Shift+Enter`, `Esc` `Esc`, `Shift+L` and `Shift+J` | on |
| **JSON Editor** | The **JSON** button next to **Inputs**, and `Shift+J` | on |
| **Output Copy** | The **⧉** copy button on method outputs (AD) | on |
| **IDE** | The **⤢** and **⧉** buttons on text boxes | on |
| **IDE Wrap** | Wrap long lines in the IDE: **Wrap** or **No Wrap** | Wrap |
| **IDE Font Size** | The IDE's font size: 12, 13, 14, 16 or 18 px | 13 px |
| **IDE Autocomplete** | `#{variable}` completion, hover and checks in the IDE (AD only) | on |
| **Debug Logging** (under **Advanced**) | Prints the extension's step-by-step messages to the browser console | off |

The **Keyboard Shortcuts** switch covers exactly those four keys. It does not affect the Settings shortcut (`Alt+,` / `Ctrl+,`) or the IDE's keys, which are always on, nor the browser-level shortcuts (`Alt+Shift+S`, `Ctrl+Shift+A`, `Ctrl+Shift+P`), which the browser handles.

---

## Keyboard shortcuts

| Shortcut | Does | Where |
|---|---|---|
| `Ctrl+Shift+Enter` | Run Test (commits the field you're typing in first) | AD |
| `Shift+J` | Open the JSON input editor (when **JSON Editor** is on) | AD, not while typing |
| `Shift+L` | Copy a link to this method | AD, not while typing |
| `Esc` `Esc` (twice within 500 ms) | Leave the current field, so your edit registers | AD, PD, in a field |
| `Alt+Shift+S` | Open the Settings modal | AD, PD |
| `Alt+,` or `Ctrl+,` | Open the Settings modal (`Ctrl+,` is taken by Firefox and Zen) | AD, PD |
| `Ctrl+S` (`Command+S`) | Save and close | IDE |
| `Ctrl+F` (`Command+F`) | Search | IDE |
| `Ctrl+Space` | Show autocomplete suggestions | IDE |
| `↑` / `↓`, `Enter` | Choose / accept a suggestion | IDE, autocomplete list open |
| `Esc` | Close the autocomplete list or search panel, else close the IDE (asks first with unsaved changes) | IDE |
| `Ctrl+Shift+A` (`Command+Shift+A` on Mac) | Jump to the newest entry in AD Network | DevTools open |
| `Ctrl+Shift+P` (`Command+Shift+P` on Mac) | Refresh PD Inspector | DevTools open |

"Not while typing" means the key does nothing while the cursor is in a text field, including fields inside embedded components and frames, so you can type a capital `J` or `L`.

While a modal is open (the IDE, the JSON editor or the Settings modal), the page shortcuts (`Ctrl+Shift+Enter`, `Esc` `Esc`, `Shift+L`, `Shift+J`) do nothing: keys belong to the topmost modal.

`Alt+Shift+S`, `Ctrl+Shift+A` and `Ctrl+Shift+P` are browser-level shortcuts. They can clash with the browser's own shortcuts (in Chrome, `Ctrl+Shift+A` searches tabs, and `Ctrl+Shift+P` opens a private window in Firefox); when one does, the browser keeps it. Change them at `chrome://extensions/shortcuts`, or in Firefox at `about:addons` → ⚙ → **Manage Extension Shortcuts**.

Browsers don't let extensions open DevTools or switch its tabs, so `Ctrl+Shift+A` and `Ctrl+Shift+P` only ask the panel to react. The AD Network or PD Inspector panel does so if it is open on that tab, or when you open it within 60 seconds of pressing the shortcut.

---

## Troubleshooting

**Nothing appears on the page.** Check that the site is in **Allowed sites** and shows **Revoke**. If it shows **Grant** or `not granted`, click **Grant**. Then reload the tab.

**The DevTools tabs are missing.** They only appear on allowed sites. Close and reopen DevTools after adding a site.

**AD Network shows UUIDs instead of names.** While a name is being looked up, a row shows the start of its UUID and `…` for the category. If the lookup fails, a red **names unavailable — …** pill in the toolbar says why (hover it for the full message). The usual reason is not being signed in: sign in to the site; the panel retries by itself for about a minute, and again for each new request. **this page is not on an allowed site** means DevTools is on a site you haven't added.

**Open didn't fill in the inputs.** The designer host must be an allowed, granted site, and the tab must be opened from the panel: a copied or reopened link fills nothing.

**The extension disappeared in Firefox.** Temporary add-ons are removed when Firefox closes. Load it again (see [Install](#install)).

**A feature stopped working after an upstream UI change.** The extension relies on the AD/PD page structure, so that's the likeliest cause. Turn on **Debug Logging** in the Settings modal, reload, and check the console for `[belz:…]` messages. The page selectors all live in `src/config/selectors.ts`. Please [open an issue](https://github.com/ParthKapoor-dev/belz-extension/issues).

---

## Development

| Command | What it does |
|---|---|
| `bun install` | Install dependencies |
| `bun run build` | Bundle everything and assemble `build/chrome` + `build/firefox`. The only command you normally need. |
| `bun run build:dist` | Bundle to `dist/` only, without the per-browser folders |
| `bun run dev` | Rebuild `build/chrome` + `build/firefox` every time you save a file |
| `bun run typecheck` | Check the TypeScript types of the source and the tests |
| `bun test` | Run the unit tests (a few seconds). One of them runs the real build, so it rewrites `dist/` |
| `bun run test:e2e` | Run the built extension in headless Chromium and Firefox, if installed |

**The edit loop:** run `bun run dev` and leave it running. After each save, click the extension's **reload** icon (`chrome://extensions`, or **Reload** in `about:debugging`), then reload the page. Reloading keeps your sites and permissions, but removing and re-adding the extension clears them.

**Keeping your sites across reinstalls.** Browsers delete an extension's data when it's removed, and so does Firefox's temporary-add-on reload. To avoid retyping your sites, copy `sites.default.json.example` to `sites.default.json` and list them there:

```json
{ "hosts": [ { "host": "your-instance.example.com", "designerHost": "" } ] }
```

On a fresh install they're restored automatically. You still need to click **Grant** once for each, because only you can approve a site permission. The file is gitignored so that your internal hostnames stay out of the repository.

**How it works.** Start with [`AGENTS.md`](./AGENTS.md), the maintained map of the codebase. Every folder also has its own `README.md` explaining what it holds and how it connects to the rest; [`src/README.md`](src/README.md) is the place to begin. Each top-level folder of `src/` is one part of the extension, and they run separately from each other:

```
src/
  designer/           content scripts on Automation Designer and Page Designer pages
  pd-inspector-page/  the PD Inspector engine, on published pages
  devtools/           the AD Network and PD Inspector DevTools panels
  background/         site registration, shortcuts, message relay
  options/            the options page (allowed sites)
  config/             settings schema, host-page selectors and timings, constants
  shared/             helpers shared by all of the above
tests/                unit tests (mirroring src/), e2e/ for real browsers
scripts/              build, per-browser packaging, dev watcher
```

---

## Releasing

Pushing a `v*` tag runs `.github/workflows/release.yml`. The tag sets the version that ships: `v1.2.3` builds version `1.2.3` (`scripts/pack.mjs --version`). The `version` in `manifest.json` and `package.json` is only what a local build carries. The workflow type-checks and runs the unit tests, then:

- Builds and signs a Chrome `.crx` and a Firefox `.xpi`.
- Attaches both to a GitHub Release.
- Publishes auto-update manifests to GitHub Pages.

With a release published, browsers can install the extension by policy and keep it updated automatically.

The workflow needs, once:

- The repo secrets `CHROME_CRX_KEY` (make it once with `openssl genrsa 2048 > key.pem` and **never rotate it**, because it fixes the Chrome extension ID), plus `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` for Mozilla signing.
- GitHub Pages enabled (Settings → Pages → Source: GitHub Actions).
- After the first release, the printed Chrome extension ID copied into `chromeId` in `release.config.json`.

---

## Privacy and permissions

**No data leaves your own AD/PD instance.** There is no analytics, no telemetry and no companion server. Method names and page configurations come from the site you're on, using your existing sign-in.

What the extension asks for, and why:

- **`storage`**: your settings, your list of allowed sites, and a cache of AD method names and categories (see below). It also passes an **Open** request's inputs from the AD Network panel to the tab it opens, for one use and at most 5 minutes, in session storage that the browser clears when it closes.
- **`scripting`**: to run its scripts on the sites you allowed, and only on their Automation Designer, Page Designer and published pages.
- **Optional host access (`https://*/*`)**: the extension starts with access to no site. Each site you add asks for its own permission (`https://<your site>/*`), which you can revoke at any time. Plain-http sites can't be added.
- **`web_accessible_resources` (`dist/modules/*`, on https pages)**: the AD and PD scripts load their code from these files. A side effect: in Chromium browsers the extension's ID is fixed, so an https page that knows it could request one of these files and learn that the extension is installed. The files contain no secrets. Firefox gives each install a random ID, so it can't be detected this way.
- **`devtools_page`**: adds the AD Network and PD Inspector panels, only when DevTools inspects an allowed site.
- **`commands`**: the browser-level keyboard shortcuts (`Alt+Shift+S`, `Ctrl+Shift+A`, `Ctrl+Shift+P`).

What the DevTools panels do on an allowed site:

- **AD Network** wraps the inspected page's `fetch` and `XMLHttpRequest` to show requests that are still in flight. It puts the page's own versions back when the tab leaves the allowed site or DevTools closes (within seconds, even if the panel could not say goodbye).
- To show method names, it asks that same site's API, with the page's own sign-in: the authorization header the page itself sent, or the sign-in token in the page's storage. These are used only for the site they came from, and forgotten when the tab navigates.
- Names and categories are cached in `chrome.storage.local` per site: used as they are for 6 hours, shown and refreshed in the background up to 14 days, and never more than 800 methods (the oldest go first).
- **PD Inspector** reads the published page's configuration from the same site.

On any other site, the panels look nothing up and change nothing on the page.

## License

MIT. See [`LICENSE`](./LICENSE).
