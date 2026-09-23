// The request-details side pane of the AD Network panel: Headers, Payload,
// Response and Timing tabs for the selected row, and a Copy button for the
// active tab's content.

import { createJsonView } from './json-tree';
import { el, kvGrid } from './view';
import { headerRows, headersToObj, prettyMaybeJson } from './format';
import type { MethodNames } from './names';
import type { InspectedSite } from './origin';
import type { HarEntry, Row } from './types';

type DetailTab = 'headers' | 'payload' | 'response' | 'timing';

// Reading a response body has three possible sources, and the pane has to try
// all of them or rows silently hang on "Loading response…":
//
//   1. har.response.content.text — HAR entries replayed from getHAR() usually
//      carry the body inline. This is the ONLY source for backfilled rows.
//   2. har.getContent(cb) — the live path, available on entries delivered by
//      onRequestFinished while our panel was open.
//   3. Neither — DevTools drops bodies it no longer retains (large responses,
//      streams, or anything captured before the panel attached). Say so
//      instead of spinning forever.
//
// getContent() is also allowed to simply never invoke its callback, which is
// what produced the stuck placeholder, so every call is raced with a timeout.
const RESPONSE_TIMEOUT_MS = 3000;
/** How long the Copy button says "Copied". */
const COPIED_MS = 900;

/** The pane's own elements, from panel.html. */
export interface DetailElements {
  pane: HTMLElement;
  body: HTMLElement;
  close: HTMLButtonElement;
  copy: HTMLButtonElement;
  tabs: HTMLButtonElement[];
}

export class DetailPane {
  private row: Row | null = null;
  private tab: DetailTab = 'headers';
  /** What Copy puts on the clipboard: the active tab's content, no headings. */
  private copyText = '';

  /** `onClosed`: the pane was closed, so the table can drop its selection. */
  constructor(
    private readonly els: DetailElements,
    private readonly names: MethodNames,
    private readonly site: InspectedSite,
    private readonly onClosed: () => void
  ) {
    els.close.addEventListener('click', () => this.close());
    els.copy.addEventListener('click', () => this.copy());
    for (const tab of els.tabs) {
      tab.addEventListener('click', () => {
        this.tab = (tab.dataset.tab as DetailTab | undefined) ?? 'headers';
        for (const t of els.tabs) t.classList.toggle('active', t === tab);
        this.render();
      });
    }
  }

  /** The row shown, if the pane is open. */
  get selected(): Row | null {
    return this.row;
  }

  show(row: Row): void {
    this.row = row;
    this.els.pane.classList.remove('hidden');
    this.render();
  }

  close(): void {
    if (!this.row) return;
    this.row = null;
    this.els.pane.classList.add('hidden');
    this.onClosed();
  }

  /** Re-render if the pane shows `uuid` on a tab that displays its name. */
  refreshIf(uuid: string): void {
    if (this.row?.uuid === uuid && this.tab === 'headers') this.render();
  }

  private copy(): void {
    const button = this.els.copy;
    navigator.clipboard.writeText(this.copyText || '').then(() => {
      button.classList.add('ok');
      button.textContent = 'Copied';
      setTimeout(() => {
        button.classList.remove('ok');
        button.textContent = 'Copy';
      }, COPIED_MS);
    }, () => {});
  }

  private render(): void {
    const row = this.row;
    if (!row) return;
    this.els.body.replaceChildren();
    this.copyText = '';
    if (this.tab === 'headers') this.renderHeaders(row);
    else if (this.tab === 'payload') this.renderPayload(row.har);
    else if (this.tab === 'response') this.renderResponse(row);
    else this.renderTiming(row.har);
  }

  private renderHeaders(row: Row): void {
    const har = row.har;
    const name = this.names.name(row.uuid);
    const category = this.names.category(row.uuid);
    const host = this.site.apiHost;
    this.els.body.append(
      el('h4', null, 'General'),
      kvGrid([
        ['Method name', name || '(resolving…)'],
        ['Category', category || '(resolving…)'],
        ['UUID', row.uuid],
        ['Chain kind', row.kind + ' (' + row.version + ')'],
        ['Request URL', row.url],
        ['HTTP method', row.httpMethod],
        ['Status', row.status || '—'],
        ['Host', host || '—']
      ]),
      el('h4', null, 'Request headers'),
      kvGrid(headerRows(har.request && har.request.headers)),
      el('h4', null, 'Response headers'),
      kvGrid(headerRows(har.response && har.response.headers))
    );
    this.copyText = JSON.stringify(
      {
        general: {
          methodName: name || null,
          category: category || null,
          uuid: row.uuid,
          chainKind: row.kind + ' ' + row.version,
          requestUrl: row.url,
          httpMethod: row.httpMethod,
          status: row.status || null,
          host: host || null
        },
        requestHeaders: headersToObj(har.request && har.request.headers),
        responseHeaders: headersToObj(har.response && har.response.headers)
      },
      null,
      2
    );
  }

  private renderPayload(har: HarEntry): void {
    const body = this.els.body;
    const post = har.request && har.request.postData;
    const query = har.request && har.request.queryString;
    if (post && typeof post.text === 'string' && post.text) {
      body.append(el('h4', null, 'Request payload'), createJsonView(post.text).element);
      this.copyText = prettyMaybeJson(post.text);
    }
    if (Array.isArray(query) && query.length) {
      body.append(el('h4', null, 'Query string'), kvGrid(query.map((q): [string, unknown] => [q.name, q.value])));
      if (!this.copyText) {
        const o: Record<string, string> = {};
        for (const q of query) o[q.name] = q.value;
        this.copyText = JSON.stringify(o, null, 2);
      }
    }
    if (!body.childNodes.length) body.append(el('pre', null, 'No request payload.'));
  }

  private renderTiming(har: HarEntry): void {
    const t: Partial<Record<string, unknown>> = { ...har.timings };
    const rows: Array<[string, unknown]> = [['Total', Math.round(har.time || 0) + ' ms']];
    const obj: Record<string, number> = { total: Math.round(har.time || 0) };
    for (const key of ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive']) {
      const ms = t[key];
      if (typeof ms === 'number' && ms >= 0) {
        rows.push([key, Math.round(ms) + ' ms']);
        obj[key] = Math.round(ms);
      }
    }
    this.els.body.append(el('h4', null, 'Timing'), kvGrid(rows));
    this.copyText = JSON.stringify(obj, null, 2);
  }

  private renderResponse(row: Row): void {
    const har = row.har;
    // 1. Inline body — no async, no chance of hanging.
    const content = (har.response && har.response.content) || {};
    if (typeof content.text === 'string' && content.text) {
      this.showResponseBody(content.text);
      return;
    }

    // 3. Nothing to ask.
    if (typeof har.getContent !== 'function') {
      this.showResponseUnavailable(row);
      return;
    }

    // 2. Ask DevTools, but never trust it to answer.
    this.els.body.append(el('pre', null, 'Loading response…'));
    let settled = false;
    const settle = (body: string | null) => {
      if (settled) return;
      settled = true;
      // The user may have selected another row or tab while we waited.
      if (this.row !== row || this.tab !== 'response') return;
      if (body) this.showResponseBody(body);
      else this.showResponseUnavailable(row);
    };

    try {
      har.getContent(settle);
    } catch {
      settle(null);
      return;
    }
    setTimeout(() => settle(null), RESPONSE_TIMEOUT_MS);
  }

  private showResponseBody(body: string): void {
    this.copyText = body ? prettyMaybeJson(body) : '';
    this.els.body.replaceChildren(
      el('h4', null, 'Response body'),
      body ? createJsonView(body).element : el('pre', null, '(empty)')
    );
  }

  private showResponseUnavailable(row: Row): void {
    this.copyText = '';
    const note =
      row.statusGroup === 'error'
        ? 'This request was canceled, so it has no response body.'
        : 'DevTools did not retain a body for this request — that happens for ' +
          'streamed responses and for requests captured before the AD Network ' +
          'panel was opened. Re-run it with this panel open to capture it.';
    this.els.body.replaceChildren(el('h4', null, 'Response body'), el('pre', null, note));
  }
}
