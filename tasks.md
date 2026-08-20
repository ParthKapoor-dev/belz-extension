bugs:

- On Published :: AD method, can't open the editor -- (not seeing the open editor / copy button)

Enhacement/Optimization

--- to implement without increasing the complexity of the application.

- PD Inspector — researched in depth, see src/features/pd-inspector/RESEARCH.md.
  All three complaints traced to ONE defect: the expected anchor list came from
  the content page's config while the actual anchor list was read from the whole
  document, which also contains the app shell.

  -> it doesn't show embedded components like navbar, sidebar
  DONE (phase 1). The shell is a separate PAGE whose layout contains a
  `router-outlet`; it is now detected, fetched, and spliced into the tree at
  the outlet. This also removed the silent +2 anchor index shift.

  -> the selection of the pd item, isn't really correct
  DONE (phase 2). The two-tag anchor count is gone (correlate.js deleted).
  Ownership now resolves by climbing to the nearest element anchored to a
  config node via its static `props.className` — 97% of visible elements on
  LT-261, against 1 usable anchor before. Hover now names the config NODE,
  not just a whole form-builder region.

  Marker-based structural alignment was tried first and abandoned: the
  runtime emits markers for its own internal markup AND omits whole
  unrendered subtrees, so markers are not 1:1 with config nodes in either
  direction. Flat zip reached 14%, tree walk 2%. See RESEARCH.md.

  -> the confidence logic
  LARGELY DISSOLVED (phase 3 remainder). The page-wide exact/approx/low
  label is gone with correlate.js. The panel now reports Anchors — a count
  of facts (className matches), not a guess — and each hover says whether
  its anchor was exact or positional. What remains: decide whether a
  positional hit needs a stronger visual signal in the highlight overlay.

  Phase 0 questions still unanswered:
  - an OPEN dialog's DOM (needs app interaction; closed dialogs contribute
    nothing — verified)
  - whether markers are ever suppressed (`disableLayoutWrapper`, and the
    `exp-layout-selector2` ng-template path that emits no host element)
  - how many markers a `loop` node produces

  Reference pages:
  https://nsm-dev.nc.verifi.dev/pages/ncdot-notice-and-storage/LT-261/list
  shell ncdot-notice-and-storage 429ba909f2d604c2b8438dda3168f9e3
  page ncdot-notice-and-storage/LT-261/list 4a2b6f09af8756cd96b197160501ce89
  page ncdot-notice-and-storage/LT-262/list 461ae8ec29071fe557d0bd9c14c5d7df

- Report to the platform owners (unrelated to the extension, found while
  researching): /rest/api/public/pagedesigner/deployable/pages serves every page
  and component config for a domain — ~45 MB across the two dev envs — with no
  authentication at all.

- The hover overlays re-arm their delegated listeners at 1s/3s/6s after start,
  because registering at `document_idle` lands before the host app bootstraps
  and that first registration never receives events. It works, but it is a
  workaround — pin down why the listeners are orphaned and replace it with an
  exact fix. It now costs twice over, since both overlays re-arm.

- Decide whether the feature-lifecycle console logging added while chasing that
  bug (`[belz] feature ON/OFF`, `applying settings (...)`) stays or goes now
  that the bug is closed. It is currently the only visibility into feature
  start/stop.

- To improve the overall IntelliSense of the editor
- discuss first: could the editor show all possible method variables like Method inputs, internal variables, output of steps (preferably outputs of previous steps) ...
- also have prettier option if possible

- Do we have a shortcut of opening the input modal in AD?

Frameworks — EVALUATED, answer is no (for all three). Measured against this repo:

  build.mjs + pack.mjs = ~140 lines, 8 entries, 0.44s, fully deterministic.
  dist: ad-content 656 KB, pd-content 653 KB, every other entry <= 30 KB.

  - wxt.dev (Vite). Requires restructuring src/ into its `entrypoints/`
    convention, and adds auto-imports (implicit code, a downgrade for this
    codebase). It does have a devtools entrypoint. But its content-script ESM
    support is documented as work-in-progress — that is exactly the capability
    the one real optimization below needs. Costs a restructure, does not buy
    the thing that matters.

  - extension.js (Rspack). Least invasive of the three — designed to adopt
    existing extensions. Real win is `dev` with HMR + auto-launching browser,
    i.e. it removes the manual "reload the extension" step. Cost: swaps a
    0.44s build we own outright for a large toolchain, and its cross-browser
    build would displace pack.mjs, which is hand-tuned for the gecko id +
    update_url and the dual background style. Not worth it for one step of
    reload friction.

  - webdriver.io. The only one filling a real gap (there is no test suite),
    but it cannot drive DevTools panels — the same restriction that killed the
    panel-focus shortcut — and the two panels are half this extension's
    surface. It would cover content-script features on a live page at the cost
    of chromedriver in CI.

    Better first move: `bun test` in-repo, zero new dependencies, since bun is
    already the toolchain. The throwaway harnesses written while building the
    last few features were all pure-function tests and should simply live here:
    extract.js classifyChainUrl, textarea-editor detectLanguage (54 cases),
    pd-inspector buildConfigIndex (25), json-editor/sync.js type coercion.
    That is where the regressions actually are. Revisit WDIO only if the
    DOM-integration layer starts breaking in ways unit tests miss.

- Lazy-load CodeMirror out of the content scripts (the real optimization —
  found while evaluating the frameworks above, and unrelated to them).

  `features/textarea-editor/modal.js` bundles alone to 620 KB. ad-content.js is
  656 KB and pd-content.js is 653 KB, so ~94% of every content script is a
  CodeMirror editor that is parsed on every AD and PD page load whether or not
  the user ever opens it. Residual after removing it is ~36 KB.

  Fix: build modal.js as its own entry and have textarea-editor/index.js do
  `await import(chrome.runtime.getURL('dist/textarea-modal.js'))` on first
  open. Needs a `web_accessible_resources` entry; Firefox supports this and
  requires the same WAR declaration, so it is cross-browser (verify on Zen).

  CAUTION — do not build it as a separate `bun build` invocation. modal.js
  imports core/state.js, core/settings.js and ui/modal-lock.js, all
  module-level singletons; a separate bundle gets its own copies, so `state`
  would be a different object and subscribeSettings a different subscriber
  list. It must be one `bun build --splitting` call over both entries so the
  shared modules land in a shared chunk. That means build.mjs moves from
  one-invocation-per-entry to a grouped call, and the emitted chunk names have
  to be covered by the WAR entry.
