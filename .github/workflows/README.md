# `.github/workflows/`

GitHub Actions workflows: one checks every push, the other builds, signs and publishes a release when a version tag is pushed.

## Contents

| File | Trigger | What it does |
|---|---|---|
| [`test.yml`](test.yml) | every `push` and `pull_request` | type-check, unit tests, full build |
| [`release.yml`](release.yml) | a pushed tag matching `v*` | signed Chrome `.crx` + Firefox `.xpi`, GitHub Release, update manifests on GitHub Pages |

## `test.yml`

One job, `test`, on `ubuntu-latest` with a 10-minute timeout:

1. Check out and install Bun 1.2.20 (`actions/checkout` and `oven-sh/setup-bun`, both pinned to a commit SHA).
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

1. Check out, install Bun 1.2.20, `bun install --frozen-lockfile`.
2. Take the version from the tag name without its `v` (`v1.2.3` becomes `1.2.3`).
3. `bun run typecheck` and `bun test`: nothing is built, signed or published from a tag that fails them.
4. `node scripts/pack.mjs --version <version>` builds `build/chrome/` and `build/firefox/`.
5. **Pack signed Chromium CRX:** writes the key to `key.pem` (with `umask 077`), runs `./node_modules/.bin/crx3 -p key.pem` on `build/chrome` into `dist-pack/belz-extension-<version>.crx`, then derives the Chrome extension ID from the public key and prints it. `-p` is crx3's key option; without it crx3 signs with a new random key and the extension ID changes.
6. **Remove the CRX key** (`if: always()`, so it also runs when signing failed): `shred -u key.pem`, falling back to `rm`.
7. **Sign Firefox XPI via AMO:** `./node_modules/.bin/web-ext sign` on `build/firefox` in the `unlisted` channel, into `dist-pack/`.
8. **Generate update manifests** in `pages/`: copies of the `.crx`/`.xpi`, stable `belz-extension-latest.crx`/`.xpi` copies, `updates.xml` (Chrome) and `updates.json` (Firefox, keyed by `firefoxId` from [`release.config.json`](../../release.config.json)). Both point at the files attached to the GitHub Release for this tag.
9. **Publish** with `gh release create` (skipped when the tag's release already exists) and `gh release upload` (the `.crx` and `.xpi`).
10. Upload `pages/` as the GitHub Pages artifact.

**Job `deploy-pages`** runs after `release` and deploys that artifact with `actions/deploy-pages`.

Browsers that force-install the extension by policy read `updates.xml` / `updates.json` from Pages (URLs in `release.config.json`) and update when a new tag is released.

## Conventions

- **Pinned tools.** Every action is pinned to a full commit SHA, with the tag it came from in a trailing comment (`# v4.4.0`); to update one, change both together. Bun is pinned to an exact version in both workflows. The signing tools `crx3` and `web-ext` are exact-version devDependencies in [`package.json`](../../package.json), locked in `bun.lock`, installed by `bun install --frozen-lockfile` and run from `node_modules/.bin`, never fetched with `npx` at release time.
- **Secrets stay in one step.** `CHROME_CRX_KEY` is passed only to the CRX step and is on disk only between that step and the removal step. `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` are passed only to the XPI step, as environment variables.

- A failed step fails the job: CRX packing, XPI signing (including a sign that produced no `.xpi`), and every `gh release` call. The one tolerated case is a release that already exists for the tag (a re-run): the workflow then uploads into it with `--clobber`. `updates.json` is only written once a signed XPI exists, so it never carries an empty `update_link`.
- One-time setup before the first tag: add the secrets, enable GitHub Pages (Settings, Pages, Source: GitHub Actions), and after the first run copy the printed Chrome extension ID into `chromeId` in `release.config.json`. The root [README.md](../../README.md) ("Releasing") covers this for users.

## Adding or changing things

- **A new CI check:** add a step to `test.yml`. Prefer running a `package.json` script so CI and local runs stay the same.
- **Changing what ships:** change [`scripts/pack.mjs`](../../scripts/pack.mjs), not the workflow; both CI and local builds use it.
