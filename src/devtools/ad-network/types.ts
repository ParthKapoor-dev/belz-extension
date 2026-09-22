// Data shapes of the AD Network panel.

import type { Entry } from 'har-format';

/**
 * A captured request: a HAR entry (the format DevTools records the network
 * in). Entries delivered live by onRequestFinished can also read their
 * response body with getContent(); entries replayed by getHAR() usually
 * cannot, but may carry the body inline in response.content.text.
 */
export type HarEntry = Entry & {
  getContent?: (callback: (content: string, encoding: string) => void) => void;
};

/** What the panel needs to know about an AD method, read from the platform. */
export interface MethodSummary {
  name: string | null;
  category: string | null;
  /** 'DRAFT' or 'PUBLISHED'. */
  state: string | null;
  /** For a published method: the uuid of its linked draft. */
  referenceId: string | null;
}

/** An AD chain request's classification, from its URL. */
export interface ChainRequestInfo {
  uuid: string;
  /** `fetch`: a definition fetch. `execute`: a run of the method. */
  kind: 'fetch' | 'execute';
  version: 'v1' | 'v2';
}

/** An in-flight chain request, as the page-side wrapper reports it. */
export interface PendingEntry {
  id: number;
  url: string;
  method: string;
  startedDateTime: string;
}
