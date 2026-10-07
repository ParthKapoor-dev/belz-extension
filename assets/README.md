# `assets/`

Files that are not code: the extension's icon, the font of its own pages, and the screenshots the docs show. [`scripts/pack.mjs`](../scripts/pack.mjs) copies the icons and fonts into each browser tree at **`icons/`** and **`fonts/`** (the paths `manifest.json` and the pages' `@font-face` rules use); the screenshots never ship.

## Contents

| Path | What it is | Ships as |
|---|---|---|
| [`icons/icon.svg`](icons/icon.svg) | The icon's source: `{b}` in the theme's accent blue and foreground on its dark ink, with a hairline border (colours from `src/designer/ui/theme.ts`). Its text uses the JetBrains Mono font. | not shipped |
| [`icons/icon-16.png`](icons/icon-16.png), [`-32`](icons/icon-32.png), [`-48`](icons/icon-48.png), [`-128`](icons/icon-128.png) | The rendered sizes `manifest.json` lists under `icons`. | `icons/icon-*.png` |
| [`fonts/`](fonts/) | Ioskeley Mono (Regular, Italic, Bold, BoldItalic `.woff2`) and its license, [`OFL.txt`](fonts/OFL.txt). | `fonts/` |
| [`screenshots/`](screenshots/) | [`ide.png`](screenshots/ide.png) (the IDE after Format, with `#{` completion open) and [`json-editor.png`](screenshots/json-editor.png) (the JSON input editor), 1280×800, taken on a local demo page with made-up content. | not shipped |

## Icons

To change the icon, edit `icon.svg` on a machine with JetBrains Mono installed, then render every size, plus the Chrome Web Store's store icon (128×128 with 16 px of transparent padding around 96×96 artwork, uploaded on the dashboard's **Store listing** tab, not part of the package):

```bash
for s in 16 32 48 128; do rsvg-convert -w $s -h $s assets/icons/icon.svg -o assets/icons/icon-$s.png; done
rsvg-convert -w 96 -h 96 assets/icons/icon.svg -o /tmp/icon-96.png
magick /tmp/icon-96.png -background none -gravity center -extent 128x128 /tmp/store-icon-128.png
```

`tests/build/manifest.test.ts` checks that the manifest lists every size and that each file exists here.

## Fonts

The monospace font of the extension's own pages: [`src/devtools/ad-network/panel.html`](../src/devtools/ad-network/panel.html) and [`src/options/options.html`](../src/options/options.html) load all four files, [`src/devtools/pd-inspector/panel.html`](../src/devtools/pd-inspector/panel.html) Regular and Bold, each with `url("fonts/...")`. Those pages sit at the root of the packaged tree, next to `fonts/`, so the URL resolves. Each page puts `"Berkeley Mono"` first in its `--mono` stack, so a locally installed Berkeley Mono wins.

The UI injected into AD/PD pages ([`src/designer/ui/theme.ts`](../src/designer/ui/theme.ts), `FONT_MONO`) names the same family but does not load these files: they are not web-accessible, so there it applies only if the user has the font installed.

To add a weight or style, add the `.woff2` here and a matching `@font-face` rule to each page that uses it.

**License:** Copyright (c) 2025, Ahmed Hatem (https://github.com/ahatem). SIL Open Font License, Version 1.1; the full text is [`fonts/OFL.txt`](fonts/OFL.txt), which ships next to the fonts and must stay with them.

## Screenshots

Taken on a static demo page with made-up content, never on a real site, so they show no internal names, hosts or data. Keep it that way when replacing one. `bun run dev` does not watch this folder, and `pack.mjs` does not copy it.
