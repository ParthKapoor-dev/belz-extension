# Releasing

Pushing a `v*` tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml). The tag sets the version that ships: `v1.2.3` builds version `1.2.3` (`scripts/pack.mjs --version`); the `version` in `manifest.json` and `package.json` is only what a local build carries. The workflow type-checks and runs the unit tests, then:

- **Chrome:** zips `build/chrome`, uploads it to the Chrome Web Store and submits it for review. The store publishes it once approved.
- **Firefox:** has Mozilla sign `build/firefox` as a self-distributed (unlisted) add-on, and publishes `updates.json` to GitHub Pages so installed copies update themselves.
- Attaches the Chrome `.zip` and the signed `.xpi` to the tag's GitHub Release.

Either store can be left out: with all its secrets unset, the workflow skips it with a notice. A store with only some of its secrets set fails the run, and so does a run with neither store set up.

## One-time setup

1. **GitHub Pages:** Settings → Pages → Source: **GitHub Actions**.
2. **Let tags deploy to Pages:** Settings → Environments → `github-pages` → Deployment branches and tags → add a tag rule `v*` (by default only the default branch may deploy, and a release runs on a tag).
3. **Firefox:** on addons.mozilla.org, Tools → Manage API Keys, create a key, and add it as the repository secrets `AMO_JWT_ISSUER` (the key) and `AMO_JWT_SECRET` (the secret).
4. **Chrome Web Store item:** register as a Chrome Web Store developer, then in the Developer Dashboard create the item by uploading a package once by hand (`build/chrome` zipped so that `manifest.json` is at the top of the zip, built with `node scripts/pack.mjs --store`). Fill in the listing, give [`PRIVACY.md`](../PRIVACY.md)'s URL (`https://github.com/ParthKapoor-dev/belz-extension/blob/main/PRIVACY.md`) as the privacy policy, choose the visibility under Distribution, and submit it. The first tag released after that must carry a higher version than this hand upload.
5. **Chrome Web Store API:** in a Google Cloud project, enable the **Chrome Web Store API**, configure the OAuth consent screen and set it to **In production** (a refresh token of a project left in testing expires after 7 days), and create an OAuth client. Get a refresh token for the publisher account with the scope `https://www.googleapis.com/auth/chromewebstore` (for example through the OAuth 2.0 Playground with your own client).
6. **Chrome secrets** (all five, or none):

   | Secret | What it is |
   |---|---|
   | `CWS_PUBLISHER_ID` | The publisher ID (Developer Dashboard → Account). Part of every Chrome Web Store API v2 path. |
   | `CWS_EXTENSION_ID` | The store item's ID. |
   | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | The OAuth client from step 5. |
   | `CWS_REFRESH_TOKEN` | The refresh token from step 5. |

7. **Optional, pin the unpacked Chrome ID:** copy the item's public key (Developer Dashboard → the item → Package → **Public key**, the base64 text between the `BEGIN`/`END` lines) into `chromePublicKey` in [`scripts/release.config.json`](../scripts/release.config.json). A local `build/chrome` then has the store item's ID wherever the folder lives. The Web Store package (`pack.mjs --store`) never carries it: the store rejects a package with a `key`.

`scripts/release.config.json` also holds the Firefox add-on ID (`firefoxId`), the GitHub Pages address (`pagesBaseUrl`, for reference) and the `updates.json` URL that goes into the Firefox manifest's `update_url` (`firefoxUpdatesJsonUrl`).

## Each release

1. Make sure `main` is green in CI.
2. **Stored data:** if anything stored in `chrome.storage` changed shape since the last release (a setting's key or values, the site list, the method cache), it ships with a migration or under a new key. Installed copies keep their data across updates. See [`src/config/README.md`](../src/config/README.md) ("Stored shapes").
3. Pick a version **higher than the last release**: both stores refuse a version they have already seen or a lower one. A version is one to four dot-separated integers.
4. Tag and push:

   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

5. Watch the **release** workflow. Chrome users get the version after the store's review; Firefox users within a day (or at once via `about:addons` → Check for Updates).

**A failed release:** fix the cause and tag the **next patch version**. A store that already accepted a version refuses it again, so re-running the same tag only helps when the failure came before any upload. A re-run finds the GitHub Release already there and uploads into it.

## Updating the store listing

The listing text, screenshots and the **Privacy practices** answers live in the Chrome Web Store Developer Dashboard, not in this repository. When a permission or what the extension reads, stores or sends changes, update [`PRIVACY.md`](../PRIVACY.md) and the dashboard's **Privacy** tab in step with the code. Keep the listing free of internal names, hostnames and real data.

## How the workflows work

**`test.yml`** runs on every push and pull request: type-check, unit tests and the full build (which runs the singleton check, `scripts/check-singletons.mjs`). The end-to-end suite needs installed browsers and runs locally.

**`release.yml`**, job `release` (one at a time, through the `release` concurrency group):

1. Takes the version from the tag (`v1.2.3` → `1.2.3`) and fails unless it is one to four dot-separated integers.
2. Checks which stores are configured; installs, type-checks and runs the unit tests, so nothing is built from a tag that fails them.
3. `node scripts/pack.mjs --version <version> --store`, then zips `build/chrome` from inside into `dist-pack/belz-extension-<version>-chrome.zip`, failing if the zipped manifest has a `key` or another version.
4. **Chrome Web Store** (when configured), with `curl` and `jq`: exchanges the refresh token for an access token, uploads the zip (`…/upload/v2/publishers/<publisher>/items/<item>:upload`, polling `:fetchStatus` up to 5 minutes until `SUCCEEDED`), then submits it (`:publish`, which must answer `PENDING_REVIEW`, `STAGED`, `PUBLISHED` or `PUBLISHED_TO_TESTERS`).
5. **Firefox** (when configured): `web-ext lint --self-hosted`, then `web-ext sign` in the `unlisted` channel, renamed to `dist-pack/belz-extension-<version>-firefox.xpi`; then `pages/updates.json` (keyed by `firefoxId`, with the XPI's release download link and `sha256` hash) and a stable `belz-extension-latest.xpi` copy.
6. Creates the GitHub Release (or uploads into an existing one) with the zip and, when there is one, the XPI, and uploads `pages/` as the Pages artifact.

Job `deploy-pages` then deploys that artifact; it is the only job in the `github-pages` environment.

**Conventions:**

- **Pinned tools.** Every action is pinned to a full commit SHA with its tag in a trailing comment (`# v7.0.1`); to update one, change both together. Bun is pinned to an exact version in both workflows. `web-ext` is an exact devDependency, installed by `bun install --frozen-lockfile`, never fetched with `npx`.
- **Least privilege.** Both workflows default the token to `contents: read`; `release` adds `contents: write`, `deploy-pages` adds `pages: write` and `id-token: write`. Checkouts keep no credentials (`persist-credentials: false`).
- **Secrets stay in one step**, as environment variables: the `CWS_*` secrets reach only the store check and the Web Store step, the `AMO_JWT_*` ones only the store check and the signing step. The Web Store access token is masked and kept in a file only the runner user can read, deleted when the step ends.
- **No expressions in scripts.** A `${{ … }}` value reaches a `run:` block through `env:`, never pasted into the script text.
- **Changing what ships** means changing [`scripts/pack.mjs`](../scripts/pack.mjs), not the workflow: CI and local builds both use it.
