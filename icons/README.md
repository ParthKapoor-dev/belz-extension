# `icons/`

The extension's icon: `{b}` in the theme's accent blue and foreground on its dark ink, with a hairline border (colours from `src/designer/ui/theme.ts`). Browsers show it in the extensions list, the toolbar menu and the store.

## Contents

| File | What it does |
|---|---|
| [`icon.svg`](icon.svg) | The source. Its text uses the JetBrains Mono font, so render it on a machine that has it installed. |
| [`icon-16.png`](icon-16.png), [`icon-32.png`](icon-32.png), [`icon-48.png`](icon-48.png), [`icon-128.png`](icon-128.png) | The rendered sizes `manifest.json` lists under `icons`. `scripts/pack.mjs` copies these four into each browser tree (`SHARED`); the SVG and this README do not ship. |

## Changing the icon

Edit `icon.svg`, then render every size and the Chrome Web Store's store icon (128×128 with 16 px of transparent padding around 96×96 artwork, as the store asks):

```bash
for s in 16 32 48 128; do rsvg-convert -w $s -h $s icons/icon.svg -o icons/icon-$s.png; done
rsvg-convert -w 96 -h 96 icons/icon.svg -o /tmp/icon-96.png
magick /tmp/icon-96.png -background none -gravity center -extent 128x128 store-icon-128.png
```

Upload the store icon on the dashboard's **Store listing** tab; it is not part of the package. `tests/build/manifest.test.ts` checks that the manifest lists every size and that each file exists.
