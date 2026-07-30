bugs:

- (none open)

Enhacement/Optimization

--- to implement without increasing the complexity of the application.

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

- Do we have a shortcut of opening the input modal in AD?

- PD Inspector, isn't working as we expect it to.
  -> the confidence logic
  -> the selection of the pd item, isn't really correct..
  -> it doesn't show embedded components like navbar, sidebar
  explanation:

If you see page: https://nsm-dev.nc.verifi.dev/pages/ncdot-notice-and-storage/LT-261/list
here after the keyword pages --> we have /ncdot-notice-and-storage/ and /LT-261/list

TO discuss: Should we use any of these frameworks?

- https://extension.js.org/
- https://wxt.dev/
  Also, Testing with this might be beneficial
- https://webdriver.io/docs/extension-testing/web-extensions/
