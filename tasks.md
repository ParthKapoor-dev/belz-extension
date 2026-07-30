bugs:

- (none open)

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
  shell   ncdot-notice-and-storage             429ba909f2d604c2b8438dda3168f9e3
  page    ncdot-notice-and-storage/LT-261/list 4a2b6f09af8756cd96b197160501ce89
  page    ncdot-notice-and-storage/LT-262/list 461ae8ec29071fe557d0bd9c14c5d7df

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

TO discuss: Should we use any of these frameworks?

- https://extension.js.org/
- https://wxt.dev/
  Also, Testing with this might be beneficial
- https://webdriver.io/docs/extension-testing/web-extensions/
