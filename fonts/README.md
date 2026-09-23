# `fonts/`

The monospace web font of the extension's own pages: the two DevTools panels and the options page. The folder is copied as-is into both packaged trees (`build/chrome/fonts/`, `build/firefox/fonts/`) by [`scripts/pack.mjs`](../scripts/pack.mjs).

## Contents

| File | What it does |
|---|---|
| [`IoskeleyMono-Regular.woff2`](IoskeleyMono-Regular.woff2) | Ioskeley Mono, regular weight |
| [`IoskeleyMono-Italic.woff2`](IoskeleyMono-Italic.woff2) | italic |
| [`IoskeleyMono-Bold.woff2`](IoskeleyMono-Bold.woff2) | bold |
| [`IoskeleyMono-BoldItalic.woff2`](IoskeleyMono-BoldItalic.woff2) | bold italic |
| [`OFL.txt`](OFL.txt) | the font's license |

## How it connects

- **Used by:** the extension pages. Each declares `@font-face` rules for the family `"Ioskeley Mono"` with `url("fonts/...")`, for the weights and styles its CSS uses:
  - [`src/devtools/ad-network/panel.html`](../src/devtools/ad-network/panel.html) loads all four files.
  - [`src/devtools/pd-inspector/panel.html`](../src/devtools/pd-inspector/panel.html) loads Regular and Bold (it uses no italics).
  - [`src/options/options.html`](../src/options/options.html) loads all four files.
- Each page puts `"Berkeley Mono"` first in its `--mono` stack, so a locally installed Berkeley Mono wins. Ioskeley Mono is the bundled fallback.
- The URLs are relative to the page. `pack.mjs` places these pages at the root of the packaged tree, next to `fonts/`, so `fonts/...` resolves.
- The UI the designer content scripts inject into AD/PD pages ([`src/designer/ui/theme.ts`](../src/designer/ui/theme.ts), `FONT_MONO`) names the same family, `"Ioskeley Mono"`, but does not load these files: they are not in `web_accessible_resources`, so a host page cannot fetch them. There the family applies only if the user has it installed; otherwise the system monospace fallbacks in the stack do.
- [`scripts/dev.mjs`](../scripts/dev.mjs) watches this folder and rebuilds on change.

## License

Copyright (c) 2025, Ahmed Hatem (https://github.com/ahatem). Licensed under the SIL Open Font License, Version 1.1. The full text is in [`OFL.txt`](OFL.txt). Keep that file next to the fonts when redistributing them.

## Adding or changing things

- **A new weight or style:** add the `.woff2` file here, then add a matching `@font-face` rule to each page that should use it.
- **Using the font on another extension page:** that page must sit at the root of the packaged tree (as the panels do) or adjust the relative URL.
