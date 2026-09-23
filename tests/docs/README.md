# `tests/docs/`

Checks that the repository's documentation stays complete and its links stay valid. These tests read files only; they load no source module and no DOM.

## Contents

| File | What it does |
|---|---|
| [`readmes.test.ts`](readmes.test.ts) | Fails if a directory has no `README.md`, or if a relative link in any `README.md` or `AGENTS.md` points at a file or folder that does not exist. |

## How it works

1. `git ls-files --cached --others --exclude-standard` lists every file the repository tracks or would track, so ignored folders (`node_modules/`, `dist/`, `build/`) are skipped.
2. Each file's directory, and every ancestor of it, must contain a `README.md`. `.github/` is the one exception: GitHub would show `.github/README.md` on the repository page instead of the root README.
3. Every Markdown link (`[text]` followed by its target in parentheses) in a README or `AGENTS.md` that is not a URL is resolved against that file's folder, and must exist. Anchors (`#section`) are ignored.

## Adding or changing things

- **A new folder:** add a `README.md` to it, following the other directory READMEs.
- **A renamed or deleted file:** fix the links the test reports. It prints each broken link as `doc -> target`.
