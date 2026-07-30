bugs:

- (none open)

Enhacement/Optimization

--- to implement without increasing the complexity of the application.

- `output-copy` is the last O(n) injection left: it still adds a Copy button per
  output container, so a 40-step method injects 40 of them (~80 node visits per
  mutation). The textarea editor was moved to a single shared, hover-positioned
  overlay — do the same here.

- The textarea overlay re-arms its delegated listeners at 1s/3s/6s after start,
  because registering at `document_idle` lands before the host app bootstraps
  and that first registration never receives events. It works, but it is a
  workaround — pin down why the listeners are orphaned and replace it with an
  exact fix.

- Decide whether the feature-lifecycle console logging added while chasing that
  bug (`[belz] feature ON/OFF`, `applying settings (...)`) stays or goes now
  that the bug is closed. It is currently the only visibility into feature
  start/stop.

- To improve the overall IntelliSense of the editor
- discuss first: could the editor show all possible method variables like Method inputs, internal variables, output of steps (preferably outputs of previous steps) ...

- Do we have a shortcut of opening the input modal in AD?

- PD Inspector, isn't working as we expect it to... (do discussion of following without picking anything up)
  -> the confidence logic
  -> the selection of the pd item, isn't really correct..
  -> it doesn't show embedded components like navbar, sidebar

TO discuss: Should we use any of these frameworks?

- https://extension.js.org/
- https://wxt.dev/
  Also, Testing with this might be beneficial
- https://webdriver.io/docs/extension-testing/web-extensions/
