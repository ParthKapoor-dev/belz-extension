# `tests/config/`

Unit tests for [`src/config/settings.ts`](../../src/config/settings.ts), the settings schema. These are pure-data tests: no DOM and no `chrome` API.

## Contents

| File | What it does |
|---|---|
| [`settings.test.ts`](settings.test.ts) | Tests the schema's consistency and the `sanitizeSetting()` / `sanitizeSettings()` validators. |

## What is covered

- **Schema consistency.** Every `select` setting's default is one of its own options. Every key in `SETTING_KEYS` appears in exactly one settings-modal section (`features`, `editor`, `advanced`, read through `settingsIn()`). A few `DEFAULT_SETTINGS` values come from the schema.
- **`sanitizeSetting()`.** Select values compare as text and come back typed (`'16'` and `' 16px'` become `16`). An unknown or missing select value falls back to the default. Toggles are coerced to booleans.
- **`sanitizeSettings()`.** Missing keys are filled with defaults, unknown keys are dropped, and anything that is not an object gives `DEFAULT_SETTINGS`.

## Adding or changing things

Adding a setting to `src/config/settings.ts` needs no change here: the schema tests loop over every key. Update the `DEFAULT_SETTINGS` assertions only if you change one of the defaults they name.
