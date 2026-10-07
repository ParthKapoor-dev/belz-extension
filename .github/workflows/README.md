# `.github/workflows/`

GitHub Actions workflows: one checks every push, the other builds, signs and publishes a release when a version tag is pushed.

## Contents

| File | Trigger | What it does |
|---|---|---|
| [`test.yml`](test.yml) | every `push` and `pull_request` | type-check, unit tests, full build |
| [`release.yml`](release.yml) | a pushed tag matching `v*` | Chrome Web Store upload, signed Firefox `.xpi`, GitHub Release, `updates.json` on GitHub Pages |

## `test.yml`

One job, `test`, on `ubuntu-latest` with a 10-minute timeout and a read-only token (`permissions: contents: read`):

1. Check out (keeping no credentials) and install Bun 1.2.20 (`actions/checkout` and `oven-sh/setup-bun`, both pinned to a commit SHA).
2. `bun install --frozen-lockfile`.
3. `bun run typecheck`: `tsc` over `src/` and `tests/`.
4. `bun test`: the unit tests in [`tests/`](../../tests/).
5. `bun run build`: [`scripts/pack.mjs`](../../scripts/pack.mjs). The build is part of the check on purpose, because it runs the singleton check (`scripts/check-singletons.mjs`).

The browser end-to-end suite ([`tests/e2e/`](../../tests/e2e/)) needs installed browsers and is run locally, not in CI.

## `release.yml`

Two jobs. Each store is optional, chosen by which repository secrets are set:

| Secret | Used for |
|---|---|
| `CWS_PUBLISHER_ID` | The Chrome Web Store publisher ID (Developer Dashboard, Account). Part of every Chrome Web Store API v2 path. |
| `CWS_EXTENSION_ID` | The store item's ID. |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | The Google Cloud OAuth client, in a project with the Chrome Web Store API enabled. |
| `CWS_REFRESH_TOKEN` | A refresh token for the publisher account with the scope `https://www.googleapis.com/auth/chromewebstore`. |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | Mozilla add-ons API key and secret for signing the XPI. |

A store whose secrets are all unset is skipped with a `::notice::`; one with only some of them set fails the run, and so does a run with neither store set up.

**Job `release`** (`ubuntu-latest`, 30-minute timeout, one release at a time via the `release` concurrency group, token allowed to write repository contents for the GitHub Release):

1. Check out (keeping no credentials) and install Bun 1.2.20.
2. Take the version from the tag name without its `v` (`v1.2.3` becomes `1.2.3`), and fail unless it is one to four dot-separated integers, the only form both browsers accept.
3. Check which stores are configured (above).
4. `bun install --frozen-lockfile`, `bun run typecheck` and `bun test`: nothing is built, signed or published from a tag that fails them.
5. `node scripts/pack.mjs --version <version> --store` builds `build/chrome/` and `build/firefox/`. `--store` leaves `key` out of the Chrome manifest (the Web Store rejects a package that has one).
6. **Zip the Chrome package:** `build/chrome` zipped from inside, so `manifest.json` is at the zip root, into `dist-pack/belz-extension-<version>-chrome.zip`; the step fails if the zipped manifest has a `key` or another version.
7. **Chrome Web Store** (when configured), with plain `curl` and `jq`:
   - exchanges the refresh token for an access token at `https://oauth2.googleapis.com/token` (the secrets go in the request body from a file, the token is masked in the log);
   - uploads the zip: `POST https://chromewebstore.googleapis.com/upload/v2/publishers/<publisher>/items/<item>:upload`; an `IN_PROGRESS` upload is polled with `GET …/v2/publishers/<publisher>/items/<item>:fetchStatus` (`lastAsyncUploadState`) for up to 5 minutes, and anything but `SUCCEEDED` fails the step;
   - submits it: `POST …/v2/publishers/<publisher>/items/<item>:publish`; the step passes on `PENDING_REVIEW`, `STAGED`, `PUBLISHED` or `PUBLISHED_TO_TESTERS`.
   Any other HTTP status fails the step with the API's own error message. The store publishes the version after its review, with the visibility set in the dashboard.
8. **Sign Firefox XPI via AMO** (when configured): `web-ext lint --self-hosted` on `build/firefox`, then `web-ext sign` in the `unlisted` channel; the signed file is renamed `dist-pack/belz-extension-<version>-firefox.xpi`.
9. **Generate updates.json** (when AMO is configured) in `pages/`: Mozilla's update manifest, keyed by `firefoxId` from [`release.config.json`](../../release.config.json), whose one entry gives the `version`, the `update_link` of the XPI attached to this tag's GitHub Release, and its `update_hash` (`sha256:…`). Also a `belz-extension-latest.xpi` copy, a stable link to the newest signed build.
10. **Publish** with `gh release create` (skipped when the tag's release already exists) and `gh release upload`: the Chrome zip always, the XPI when there is one.
11. Upload `pages/` as the GitHub Pages artifact (when AMO is configured).

**Job `deploy-pages`** runs after `release` when AMO is configured, and deploys that artifact with `actions/deploy-pages`. It is the only job allowed to publish to Pages (`pages: write`, `id-token: write`) and the only one in the `github-pages` environment.

Installed Firefox copies read `updates.json` from the URL in the manifest's `update_url` (`firefoxUpdatesJsonUrl` in `release.config.json`) and update when a new tag is released. Chrome copies are updated by the Web Store.

## Conventions

- **Pinned tools.** Every action is pinned to a full commit SHA, with the tag it came from in a trailing comment (`# v4.4.0`); to update one, change both together. Bun is pinned to an exact version in both workflows. The signing tool `web-ext` is an exact-version devDependency in [`package.json`](../../package.json), locked in `bun.lock`, installed by `bun install --frozen-lockfile` and run from `node_modules/.bin`, never fetched with `npx` at release time. The Chrome Web Store is called with `curl` and `jq` from the runner image.
- **Secrets stay in one step.** The `CWS_*` secrets are passed only to the store check and the Web Store step, `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` only to the store check and the XPI step, always as environment variables. The Web Store access token lives in a temporary file readable only by the runner user (`umask 077`), removed when the step ends.
- **Least privilege.** Both workflows default the token to `contents: read`; a job that needs more says so itself (`release`: `contents: write`; `deploy-pages`: `pages: write`, `id-token: write`). `actions/checkout` runs with `persist-credentials: false`.
- **No expressions in scripts.** A `${{ … }}` value (a secret, a step output) reaches a `run:` block through `env:` and is used as a shell variable, never pasted into the script text; the tag and repository come from the runner's own `GITHUB_REF_NAME` and `GITHUB_REPOSITORY`.
- **A failed step fails the job:** the version check, the zip check, every Web Store call, XPI signing (including a sign that produced no `.xpi`), and every `gh release` call. The one tolerated case is a release that already exists for the tag (a re-run): the workflow then uploads into it with `--clobber`. A store that already accepted a version refuses it again, so a release that failed after that point is retried with the next patch version rather than re-run. `updates.json` is only written once a signed XPI exists, so it never carries an empty `update_link`.
- **One-time setup** before the first tag: the secrets; GitHub Pages enabled with **Source: GitHub Actions** (Settings, Pages); and the `github-pages` environment allowed to deploy from tags `v*` (Settings, Environments, `github-pages`, Deployment branches and tags), since a release runs on a tag. The Chrome Web Store item must exist (created once by hand in the Developer Dashboard) before the API can upload to it. The root [README.md](../../README.md) ("Releasing") has the full checklist.

## Adding or changing things

- **A new CI check:** add a step to `test.yml`. Prefer running a `package.json` script so CI and local runs stay the same.
- **Changing what ships:** change [`scripts/pack.mjs`](../../scripts/pack.mjs), not the workflow; both CI and local builds use it.
