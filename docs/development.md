# Development

Building belz-extension from source, the edit loop, and the tests. How the code fits together is in [`AGENTS.md`](../AGENTS.md) (the maintained map of the codebase) and [`src/README.md`](../src/README.md); every folder under `src/` has its own `README.md`.

## Requirements

- [Git](https://git-scm.com/).
- [Bun](https://bun.sh/) (CI and the release build use Bun 1.2.20):
  - macOS and Linux: `curl -fsSL https://bun.com/install | bash`
  - Windows (PowerShell): `powershell -c "irm bun.sh/install.ps1|iex"`
- [Node.js](https://nodejs.org/): 18 or newer to build, 20 or newer for `bun run dev` on Linux (it needs recursive file watching), 22 or newer for the end-to-end tests (they use Node's built-in `WebSocket`).

## Build and load

```bash
git clone https://github.com/ParthKapoor-dev/belz-extension.git
cd belz-extension
bun install
bun run build
```

That creates a ready-to-load extension for each browser family under `build/`:

- **Chrome, Edge, Brave:** open `chrome://extensions` (or `edge://extensions`, `brave://extensions`), turn on **Developer mode**, click **Load unpacked** and choose the **`build/chrome`** folder.
- **Firefox, Zen:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose **`build/firefox/manifest.json`**. Firefox removes temporary add-ons when it closes, so repeat this after each restart.

**Load from `build/`, never from the repo root.** The root `manifest.json` is a template that the build splits per browser ([`scripts/manifests.mjs`](../scripts/manifests.mjs)); it will not load in Firefox.

A build you load yourself and the published version are separate installs with separate data. Then [set up your sites](usage.md#setup).

## Commands

| Command | What it does |
|---|---|
| `bun install` | Install dependencies |
| `bun run build` | Bundle everything and assemble `build/chrome` + `build/firefox`. The only command you normally need. |
| `bun run build:dist` | Bundle to `dist/` only, without the per-browser folders |
| `bun run dev` | Rebuild `build/chrome` + `build/firefox` every time you save a file |
| `bun run typecheck` | Check the TypeScript types of the source and the tests |
| `bun test` | Run the unit tests (a few seconds). One of them runs the real build, so it rewrites `dist/` |
| `bun run test:e2e` | Run the built extension in headless Chromium and Firefox, if installed |

What each build script does is in [`scripts/README.md`](../scripts/README.md).

## The edit loop

Run `bun run dev` and leave it running. After each save, click the extension's **reload** icon (`chrome://extensions`, or **Reload** in `about:debugging`), then reload the page. Reloading keeps your sites and permissions; removing and re-adding the extension clears them.

### Keeping your sites across reinstalls

Browsers delete an extension's data when it is removed, and Firefox's temporary-add-on reload does too. To avoid retyping your sites, create `sites.default.json` at the repo root:

```json
{
  "hosts": [
    { "host": "your-instance.example.com", "designerHost": "" }
  ]
}
```

`designerHost` is optional: set it only when a site serves the Automation Designer on a different host from the one you browse. The build copies the file into both trees, and on a fresh install the background restores the list from it whenever storage holds no site list at all (an emptied list is never re-seeded). You still click **Grant** once for each site, because only you can approve a site permission. The file is gitignored so that your own hostnames stay out of the repository.

## Tests

- **Unit tests:** `bun test`, in [`tests/`](../tests/), mirroring `src/`, with happy-dom and an in-memory `chrome` API. A memory guard kills the run at 1 GB (`BELZ_TEST_MEMORY_LIMIT_MB` to change it): never pass a value that holds DOM nodes to `expect()`, because a failing assertion on one makes bun's printer walk the whole DOM. Running the tests under an outer memory cap (for example `systemd-run --user --scope -p MemoryMax=4G bun test`) is a sensible second backstop.
- **End-to-end:** `bun run test:e2e` builds, then loads the packaged extension in headless Chromium and Firefox and checks the IDE, the formatter, Vim mode and the shared modal lock on a local page. A browser that is not installed is skipped. `--no-build` reuses `build/`; `--only chromium` or `--only firefox` runs one.
- **Type-check:** `bun run typecheck`.

CI ([`.github/workflows/test.yml`](../.github/workflows/test.yml)) runs the type-check, the unit tests and the build on every push and pull request; the end-to-end suite runs locally. More on the tests and their conventions in [`tests/README.md`](../tests/README.md); the repo-wide rules are in [`AGENTS.md`](../AGENTS.md) ("Testing").

## Project layout

```
src/        the extension, one folder per JavaScript world (see src/README.md)
tests/      unit tests mirroring src/, e2e/ for real browsers
scripts/    build, per-browser packaging, dev watcher, release config
assets/     icons, fonts, README screenshots
docs/       usage, development and release guides
```
