# `.github/workflows/`

GitHub Actions workflows: one checks every push, the other builds, signs and publishes a release when a version tag is pushed.

## Contents

| File | Trigger | What it does |
|---|---|---|
| [`test.yml`](test.yml) | every `push` and `pull_request` | type-check, unit tests, full build |
| [`release.yml`](release.yml) | a pushed tag matching `v*` | signed Chrome `.crx` + Firefox `.xpi`, GitHub Release, update manifests on GitHub Pages |

## `test.yml`

One job, `test`, on `ubuntu-latest` with a 10-minute timeout:

1. Check out, install the latest Bun (`oven-sh/setup-bun@v2`).
2. `bun install --frozen-lockfile`.
3. `bun run typecheck`: `tsc` over `src/` and `tests/`.
4. `bun test`: the unit tests in [`tests/`](../../tests/).
5. `bun run build`: [`scripts/pack.mjs`](../../scripts/pack.mjs). The build is part of the check on purpose, because it runs the singleton check (`scripts/check-singletons.mjs`).

The browser end-to-end suite ([`tests/e2e/`](../../tests/e2e/)) is not run in CI.

## `release.yml`

Two jobs. `release` needs these repository secrets:

| Secret | Used for |
|---|---|
| `CHROME_CRX_KEY` | PEM private key that signs the CRX. It fixes the Chrome extension ID: create it once and never rotate it. |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | Mozilla add-ons API key and secret for signing the XPI. |

**Job `release`** (`ubuntu-latest`, environment `github-pages`, one release at a time via the `release` concurrency group):

1. Check out, install Bun, `bun install --frozen-lockfile`.
2. Take the version from the tag name without its `v` (`v1.2.3` becomes `1.2.3`).
3. `node scripts/pack.mjs --version <version>` builds `build/chrome/` and `build/firefox/`.
4. **Pack signed Chromium CRX:** writes the key to `key.pem`, runs `npx crx3` on `build/chrome` into `dist-pack/belz-extension-<version>.crx`, derives the Chrome extension ID from the public key, prints it, and deletes the key.
5. **Sign Firefox XPI via AMO:** `npx web-ext sign` on `build/firefox` in the `unlisted` channel, into `dist-pack/`.
6. **Generate update manifests** in `pages/`: copies of the `.crx`/`.xpi`, stable `belz-extension-latest.crx`/`.xpi` copies, `updates.xml` (Chrome) and `updates.json` (Firefox, keyed by `firefoxId` from [`release.config.json`](../../release.config.json)). Both point at the files attached to the GitHub Release for this tag.
7. **Publish** with `gh release create` (skipped when the tag's release already exists) and `gh release upload` (the `.crx` and `.xpi`).
8. Upload `pages/` as the GitHub Pages artifact.

**Job `deploy-pages`** runs after `release` and deploys that artifact with `actions/deploy-pages@v4`.

Browsers that force-install the extension by policy read `updates.xml` / `updates.json` from Pages (URLs in `release.config.json`) and update when a new tag is released.

## Conventions

- A failed step fails the job: CRX packing, XPI signing (including a sign that produced no `.xpi`), and every `gh release` call. The one tolerated case is a release that already exists for the tag (a re-run): the workflow then uploads into it with `--clobber`. `updates.json` is only written once a signed XPI exists, so it never carries an empty `update_link`.
- One-time setup before the first tag: add the secrets, enable GitHub Pages (Settings, Pages, Source: GitHub Actions), and after the first run copy the printed Chrome extension ID into `chromeId` in `release.config.json`. The root [README.md](../../README.md) ("Releasing") covers this for users.

## Adding or changing things

- **A new CI check:** add a step to `test.yml`. Prefer running a `package.json` script so CI and local runs stay the same.
- **Changing what ships:** change [`scripts/pack.mjs`](../../scripts/pack.mjs), not the workflow; both CI and local builds use it.
