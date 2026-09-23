// "AD Network" DevTools panel entry. The panel itself is AdNetworkPanel
// (network-panel.ts); this file only starts it, so tests can import the
// class without side effects.
import { AdNetworkPanel } from './network-panel';

new AdNetworkPanel().start();
