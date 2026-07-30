# PD Inspector — platform research notes

Findings from a live investigation of the expertly/verifi platform, 2026-07-31,
against `nsm-dev.nc.verifi.dev` and `sems-dev.qa.expertly.cloud`.

`HOW-IT-WORKS.md` describes the design as originally built. **Parts of it are
now known to be wrong** — see "Corrections" at the end. This file is the record
of what was actually measured, so the next person does not have to re-derive it.

Everything below is marked **VERIFIED** (observed directly) or **INFERRED**.

---

## 1. How a published page is assembled

**VERIFIED.** `path` is a single flat opaque lookup key, not a hierarchy. But
rendering is two-level on some domains:

```
ncdot-notice-and-storage              429ba909f2d604c2b8438dda3168f9e3   SHELL
  └─ its layout contains a literal { name: "router-outlet" } node
ncdot-notice-and-storage/LT-261/list  4a2b6f09af8756cd96b197160501ce89   CONTENT
ncdot-notice-and-storage/LT-262/list  461ae8ec29071fe557d0bd9c14c5d7df   CONTENT
ncdot-notice-and-storage/LT-261       not deployed → HTTP 200 + [null]
```

The content page renders into the shell's outlet. Intermediate path segments are
not pages.

**The shell is not a distinct API concept** — it is an ordinary PAGE that happens
to contain an outlet node. `pageType` is exactly `PAGE | COMPONENT | ALL`;
`LAYOUT`, `TEMPLATE`, `SHELL`, `THEME`, `MENU`, `SYMBOL`, `MASTER` and 15 others
all return HTTP 400 naming `PageFilter$PageType`.

**The navbar and sidebar live in the shell**, via an embedded component:

```
ncdot-notice-and-storage (PAGE, has router-outlet)
└── n_s_verifi-staff-header-dmv (COMPONENT)
    ├── n_s_side-bar-nav-link          the sidebar
    ├── support-btn
    ├── n_s_style_verifi-staff-header  style-only component
    └── n_s_style_side-bar-nav         style-only component
```

`style_*` / `n_s_style_*` components exist purely to inject CSS and are
candidates for collapsing in the tree UI.

### Shells are not universal

**VERIFIED.** `router-outlet` appears in **4 of 348** nsm-dev configs
(`ncdot-notice-and-storage`, `ncdmv-ahs`, `parent`, `test-clone`) and in **0 of
392** sems-dev configs. sems-dev pages are standalone.

**Never assume "first path segment = shell."** Probe it and check the fetched
config for an outlet node.

**Detect the outlet in the CONFIG, never in the DOM.** The DOM also contains
Angular's own app-level outlets — sems-dev shows 3 `<router-outlet>` elements
while having no outlet node in any config at all.

---

## 2. The deployable endpoint

```
GET /rest/api/public/pagedesigner/deployable/pages
      ?pageType=ALL|PAGE|COMPONENT
      &domain=<host>
      &path=<app path, or component name, or empty>
      [&deployableInfo=true]
```

**VERIFIED response shape:**

| query | top-level keys |
|---|---|
| plain | `deployedPages`, `etag`, `empty` |
| `deployableInfo=true` | `deployedPages`, `pdHost`, `dynamicRoute`, `etag`, `empty` |

`dynamicRoute` is **only** present with `deployableInfo=true` — which is exactly
what `resolveDeployedPath` in `config.js` passes. That code is correct.

Entry keys: `pageVersionId`, `deployableId`, `compiledConfig` (a JSON *string*),
`path`, `aliasName` (array), `hostId`, `referencePageId`, and `isComponent`
(**present only when true**).

A miss is **HTTP 200 with `deployedPages: [null]`**, never a 404. Null-check the
array element, not the status or the length.

### `path=` (empty) dumps the whole catalog

**VERIFIED.** One request returns every deployed page and component for the
domain — 348 entries / ~25 MB on nsm-dev, 392 / ~20 MB on sems-dev. This gives a
complete `path → referencePageId` map, so any component name can be linked to
its ui-designer URL without a lookup per name.

### `aliasName`

A component node's `name` may be an alias rather than the canonical `path`.
The app's own preloader registers every `aliasName` as an alias. Resolve
aliases or some components will fail to link.

### compiledConfig envelope

**VERIFIED**, all 348 nsm + 392 sems entries: `layout`, `styles`, `context`,
`http`, `helpText` — plus `events`, `inputs`, `methods` on exactly the 242
`isComponent: true` entries. That triple is a reliable page-vs-component
discriminator from inside the config alone.

Note this is the **legacy** envelope (`context` / `http`), not the modern
`variables` / `httpRequests` shape documented elsewhere. Handle both.

### No authentication

**VERIFIED.** This endpoint served the complete page and component source for
both environments — ~45 MB, 740 configs — to a plain `curl` with no cookies and
no token, HTTP 200. The configs contain business logic, JS event handlers and
internal route graphs. This is almost certainly unintended and is worth raising
with the platform owners independently of any inspector work.

---

## 3. DOM ↔ config identification

### The runtime DOES leave markers

**VERIFIED** on `nsm-dev` (LT-261 list) and `sems-dev` (manual-placement):

```html
<exp-layout class="exp-layout-use-sibling"></exp-layout>
<div class="...">…the actual rendered content…</div>
```

The runtime emits one **empty, zero-size** `<exp-layout>` marker per rendered
config node, and the element it describes is its **next sibling** — which is
what `exp-layout-use-sibling` means.

| | nsm-dev LT-261 | sems-dev manual-placement |
|---|---|---|
| markers | 396 | 44 |
| with a next sibling | 381 | 42 |
| distinct targets | 381 | 42 |
| mapping injective | yes | yes |
| orphan markers | 15 | 2 |
| target tree depth | 11 | — |

The targets form a single clean nested tree. **This is the identification
handle**: 381 addressable points on a page where the old anchor scheme had 1.

### Orphan markers mark nodes that did NOT render

**VERIFIED.** Every one of the 15 nsm orphans is the last child of its parent
with no next sibling. A marker with no sibling means the config node it stands
for produced no DOM.

This is significant: **the DOM explicitly marks the position of hidden nodes.**
Alignment gaps do not have to be inferred, and there is no need to guess *which*
conditional dropped — the reason the current confidence score exists.

### What does NOT work — tested, do not retry

- **`__ngContext__`** is present on every marker (396/396) but holds a
  *globally unique view id*, not an index — 410 elements gave 410 distinct
  values. Resolving it needs Angular's internal `getLViewById`, which is
  module-private.
- **`window.ng`** is `undefined`. Production build, no debug API.
  (`getAllAngularRootElements` exists but only yields root elements.)
- **`ng-reflect-*`**: zero occurrences. Production build.
- **`_nghost-*` / `_ngcontent-*`**: present, but a red herring — they scope a
  *widget's* stylesheet and are identical across every instance. They identify
  the Angular component class, never the PD node or the authoring component.
- The marker element carries **one own property** (`__ngContext__`) and **one
  attribute** (`class`). Nothing else.

Conclusion: identification cannot be a direct property read. It must be a
**structural alignment** of the config tree against the marker-target tree.

### Markers come in RUNS, and there is no count law

**VERIFIED.** The first design sketch assumed one marker per rendered config
node, so config and DOM could be zipped in document order. That is wrong twice
over, and both corrections matter for the aligner.

**1. Markers chain.** A marker's next sibling is frequently *another marker*.
On LT-261, 108 of 396 targets are `exp-layout` elements, and every one of those
is itself a `use-sibling` marker (there are no `exp-layout` elements without the
class). A concrete chain:

```
<exp-layout class="exp-layout-use-sibling">   marker
<exp-layout class="exp-layout-use-sibling">   marker
<span class="format-tooltip inline-…">        the actual element
```

So a *run* of N consecutive markers terminates in one real element. The run
length is meaningful — it is a chain of config nodes that delegate rendering
down to the same element (a symbol reference and the symbol's own root, for
example). Breakdown on LT-261: 396 markers = 273 pointing at a real element +
108 pointing at the next marker + 15 orphans.

**2. Counts do not correspond.** Two environments, two directions:

| | config nodes | `[isVisible]` bound | markers | direction |
|---|---|---|---|---|
| nsm LT-261 list | 354 | 42 | **396** | more markers than nodes |
| sems manual-placement | 51 | 6 | **44** | fewer markers than nodes |

`354 + 42 = 396` looks like a law on nsm and is a coincidence — it predicts 57
for sems, where 44 were observed. Do not build on it.

**3. Document order does not align naively.** First few of each on LT-261:

```
config:  div, exp-form-field, exp-layout-dialog, mat-dialog-content, mat-dialog-actions, …
DOM:     div, div,            exp-svg-icon,      exp-layout-dialog,  exp-layout-dialog,  …
```

**Consequence for the aligner:** it must be a genuine recursive tree walk with
resynchronisation — config tree against the tree of run-terminal elements —
consuming marker runs, skipping config nodes that produced nothing, and matching
on expected tag. A flat sequence zip of any kind will not work, whether by count
or by position.

### Markers are NOT 1:1 with config nodes, in either direction

**VERIFIED.** Two separate causes, and together they rule out any positional or
count-based alignment:

1. **Unrendered subtrees emit nothing below their own marker.** A node that does
   not render still emits its marker (that is what an orphan is), but its
   descendants emit none. A closed `exp-layout-dialog` has 0 children in the
   DOM while carrying several in the config.
2. **The runtime emits markers for its OWN internal markup.** A config
   `exp-form-field` with zero children renders as `div.form-field-wrap`
   containing a further marker for an `exp-svg-icon` that appears nowhere in
   the config.

Measured attempts on the reference page, all failures:

| approach | result |
|---|---|
| flat zip, marker[i] ↔ configNode[i] | 14% tag agreement |
| sequential consumption with subtree skipping | 170/410 markers, 9% consistency |
| tree walk matching children by tag | 2% coverage |

The learned name→tag map is noise under all three
(`div -> div:18, span:18, exp-html-template:9, …`), which is the signature of a
walk that has drifted rather than a mapping that needs more entries.

### className IS ground truth — and it is what the resolver uses

**VERIFIED.** A node's static `props.className` survives into the rendered
element's class list. On the reference page 168 of 354 composed config nodes
carry one, spanning 82 distinct className strings.

That gives real anchor points, and — unlike everything above — it is checkable
rather than inferred. Resolution is then: climb from the hovered element to the
nearest anchored ancestor and read its config node and component chain.

Measured with the shipped `resolve.js`, run verbatim against the live page:

```
anchored elements      96   (32 exact, 65 positional)   loose pairing
hover coverage         98% of 1158 visible elements
```

**Pairing rule matters more than coverage.** When several config nodes share a
className and several elements match it, pairing them in document order is only
sound if the counts agree. Pairing them anyway ("loose") buys 1% coverage and
corrupts ownership: a generic `overflow-hidden` anchor (18 candidates) landed
inside the sidebar and attributed the whole sidebar to the *shell* rather than
to `n_s_verifi-staff-header-dmv`, because resolution takes the NEAREST anchored
ancestor and a wrong near anchor shadows the correct outer one.

| rule | anchors | coverage | sidebar owner |
|---|---|---|---|
| loose (pair min(n,m)) | 96 | 98% | `ncdot-notice-and-storage` ✗ |
| strict (pair only when n == m) | 69 | 97% | `n_s_verifi-staff-header-dmv` ✓ |

The shipped code uses **strict**. A wrong anchor is worse than no anchor.

For comparison, the scheme this replaced had **one** usable anchor on this page
(one `exp-data-table`, zero `exp-form-builder`).

### Dialogs

**VERIFIED (closed state only).** All 7 `exp-layout-dialog` elements on LT-261
were `_d-none` with zero children and zero markers inside; the
`.cdk-overlay-container` existed but was empty. Closed dialogs contribute
nothing to alignment.

**NOT VERIFIED:** an open dialog. Opening one requires interacting with the app,
which was out of scope for read-only work. Expect its content to render into the
CDK overlay, outside the page tree, and to need handling as a separate root.

---

## 4. Why the original correlation is broken

The inspector builds its **expected** anchor list from one page's config, but
reads its **actual** list from `document.querySelectorAll('exp-form-builder')` —
unscoped, whole document. The shell renders around the content page, so shell
anchors come first.

**VERIFIED** by expanding both configs in document order:

```
DOM order a browser sees:  [FB, FB, FB, DT, DT]
                            └shell┘  └── page ──┘
Inspector expects:         [FB, DT, DT]

exp-form-builder   shell contributes 2 before the outlet → page indices +2
exp-data-table     shell contributes 0                   → unaffected
```

Every form-builder identification is shifted by two, silently and always.
Data-tables were unaffected only because this shell has none, which is why the
bug never looked systematic.

**It is worse in practice.** On the live LT-261 page:

| | config predicts | actually in the DOM |
|---|---|---|
| `exp-form-builder` | 3 | **0** |
| `exp-data-table` | 2 | **1** |
| `exp-layout` markers | — | **396** |

There are no form-builders at all. The correlator is not merely misaligned
there — it has almost nothing to align, so most hovers fall through to
"component undetermined".

This single defect produces all three reported symptoms: the navbar is missing
(never fetched), selection is wrong (indices shifted), and confidence is
meaningless (computed from mismatched counts).

---

## 5. Other useful config facts

**`__LAYOUT_CONFIG_METADATA.NAVIGATION`** (286 occurrences on nsm) carries the
target page id and route of a navigation action:

```json
{"NAVIGATION": {"page": {"id": "406c644cc2511cc15f309adb44137e99",
                         "route": "ncdot-notice-and-storage/LT-261/:id/details"},
                "type": "Internal Navigation", "isDynamic": true}}
```

Those ids are `referencePageId`s — enough to build a real page graph and offer
"jump to the target page".

Other metadata keys seen: `displayName`, `__CHAMBER_DIV_FLAG`,
`__FORM_COLUMN_SIZES`, `__FORM_CONFIG_VARIABLE`, `triggerNodeList`, `EVENTS`.

**Symbol ref vs definition** (unchanged, still correct):
`isSymbol && name && no children` = an embed point.
`isSymbol && has children` = the component's own definition root.

**Distinct `exp-*` / `wis-*` tags across all 348 nsm configs:**
`exp-form-field` 468, `exp-horizontal-container` 434, `exp-html-template` 430,
`wis-toast` 349, `exp-tab` 346, `exp-loader` 299, `wis-redirect` 269,
`exp-layout-dialog` 246, `exp-data-table` 239, `exp-form-builder` 199,
`exp-pagination-controls` 193, `exp-popover` 149, `exp-tabs-panel` 97,
`wis-breadcrumbs` 78, `exp-chart-card` 55, `wis-search-box` 10, `exp-svg-icon` 7,
`exp-file-preview` 6, `exp-dms-upload` 5, `exp-dynamic-field` 2, `exp-aside` 1.

**A host page renders the PUBLISHED version of an embedded symbol**, even while
you are viewing a draft, and the preview caches it. So a fetched component config
can legitimately not match what rendered. This is the one place a confidence
signal is genuinely warranted.

**`loop` instantiates only DIRECT children** of the looped node.
**`[isVisible]` compiles to `*ngIf`** — false removes the node from the DOM
entirely. Static `props.isVisible: false` **wins over** `[isVisible]` and is
knowable with certainty at parse time.

---

## Corrections to HOW-IT-WORKS.md

1. **"the runtime leaves no marker" is wrong.** It emits one `<exp-layout>`
   marker per rendered node. The original probing looked for attributes; the
   markers are *elements*. See §3.
2. **"the component tree is exact" is wrong when a shell exists** — the tree
   omits everything in the shell, including the navbar and sidebar, because the
   shell is a separate page and unreachable from the content page's symbol
   closure.
3. **The confidence score is not just honest uncertainty.** It is computed from
   two document-wide `querySelectorAll` counts that include shell elements the
   config walk never predicted, so its inputs are wrong before any inference
   happens.

---

## Still open

- An **open** dialog's DOM (needs app interaction).
- Whether markers are ever suppressed — the `exp-layout` component has a
  `disableLayoutWrapper` input, and an attribute-directive render path
  (`exp-layout-selector2` on `<ng-template>`) emits no host element. Neither was
  observed in the wild, but neither was ruled out.
- Loop/repeater behaviour: how many markers a looped node produces (expected N,
  one per iteration, but unmeasured).
