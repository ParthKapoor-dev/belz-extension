// "AD Network" DevTools panel.
//
// A custom Network-tab-style panel scoped to Automation Designer "chain"
// requests. Two capture pipelines feed the list:
//   1. chrome.devtools.network — the log DevTools already records, replayed
//      on init via getHAR() and streamed live via onRequestFinished. Zero
//      page overhead, but only sees COMPLETED requests.
//   2. PendingCapture (pending-capture.ts) — a fetch/XHR wrapper injected into
//      the inspected page. Reports in-flight requests so we can show pending
//      rows the same way the OG Network tab does.
//
// Name + category come from two sources:
//   - definition fetches  -> the name is in the recorded response body
//   - MethodResolver      -> the platform's own chain endpoint on the
//     (api.ts)               inspected host, cached SWR in MethodCache
//
// This file is the table and the wiring; the detail pane (detail.ts), name
// resolution (names.ts), "Open in draft" (open-draft.ts), the toast and
// offline pill (status.ts) and formatting (format.ts, view.ts) live apart.

import { classifyChainUrl, extractMethodNameFromChainResponse } from './extract';
import { PendingCapture } from './pending-capture';
import { InspectedSite } from './origin';
import { MethodResolver, noDesignerUrlReason } from './api';
import { MethodCache } from './cache';
import { MethodNames, ResolveQueue } from './names';
import { DetailPane } from './detail';
import { OpenQueue, openInBackgroundTab, withAutofill } from './open-draft';
import { PanelStatus } from './status';
import {
  buildCurl,
  formatBytes,
  harKey,
  lookupFailure,
  shortUuid,
  shortUuidFromUrl,
  startedAt,
  statusGroup,
  transferSize,
  typeOf
} from './format';
import { flashOk, flashText, iconButton, ICON_COPY, ICON_LINK, ICON_OPEN } from './view';
import { el, FocusFlash } from '../view';
import { required } from '../../shared/dom';
import { errorText } from '../../shared/errors';
import { watchFocusFlag } from '../../shared/focus-flag';
import { createLogger } from '../../shared/logger';
import { copyRichLink } from '../../shared/rich-link';
import type { HarEntry, MethodSummary, PendingEntry, Row } from './types';

const MAX_ROWS = 300;

const log = createLogger('ad-network');

/** The panel's elements, from panel.html. */
function panelElements() {
  return {
    record: required<HTMLButtonElement>('#record'),
    clear: required<HTMLButtonElement>('#clear'),
    preserve: required<HTMLInputElement>('#preserve'),
    filter: required<HTMLInputElement>('#filter'),
    count: required('#count'),
    offline: required('#offline'),
    listPane: required('.list-pane'),
    rows: required<HTMLTableSectionElement>('#rows'),
    empty: required('#empty'),
    toast: required('#toast'),
    pendingRows: required<HTMLTableSectionElement>('#pending-rows'),
    detail: {
      pane: required('#detail'),
      body: required('#detail-body'),
      close: required<HTMLButtonElement>('#detail-close'),
      copy: required<HTMLButtonElement>('#detail-copy'),
      tabs: Array.from(document.querySelectorAll<HTMLButtonElement>('.detail-tabs button'))
    }
  };
}

type PanelElements = ReturnType<typeof panelElements>;

export class AdNetworkPanel {
  private readonly site = new InspectedSite();
  private readonly cache = new MethodCache();
  private readonly resolver = new MethodResolver(this.site, this.cache);
  private readonly names = new MethodNames((uuid) => this.repaint(uuid));
  /** Settles once origin, site config and cache are loaded; made anew by each start(). */
  private ready: Promise<void> = Promise.resolve();
  private readonly status: PanelStatus;
  private readonly queue = new ResolveQueue(this.resolver, this.names, () => this.ready, (failed, reason) =>
    this.status.setOffline(failed, reason)
  );
  private readonly detail: DetailPane;
  private readonly pending = new PendingCapture((entries) => this.updatePending(entries));
  /** "Open in draft" requests, handled one at a time. */
  private readonly openQueue = new OpenQueue((row, isCurrent) => this.openInDraft(row, isCurrent));
  private readonly flash = new FocusFlash();

  /** Chronological (oldest first by start time); mirrors the DOM order. */
  private readonly rows: Row[] = [];
  /** Dedup keys of captured requests (see harKey). */
  private readonly seen = new Set<string>();
  /** In-flight rows: pending id -> table row. */
  private readonly pendingRows = new Map<number, HTMLTableRowElement>();
  private nextId = 1;
  private recording = true;
  private preserveLog = false;
  private filterText = '';
  private started = false;
  /** Bumped per start and stop, so async work from an earlier run is dropped. */
  private runId = 0;
  private unwatchFocus: (() => void) | null = null;
  private unwatchSite: (() => void) | null = null;

  /** Only keeps references: nothing is read or wired until start(). */
  constructor(private readonly els: PanelElements = panelElements()) {
    this.detail = new DetailPane(els.detail, this.names, this.site, () => this.markSelected(null));
    this.status = new PanelStatus(els.toast, els.offline);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const runId = ++this.runId;
    this.ready = (async () => {
      await Promise.all([this.site.detect(), this.site.loadSiteConfig(), this.cache.hydrate()]);
      if (runId !== this.runId) return;
      this.unwatchSite = this.site.watchSiteConfig(this.applySiteAccess);
      this.applySiteAccess();
    })();

    const { record, clear, preserve, filter } = this.els;
    record.addEventListener('click', this.onRecordClick);
    clear.addEventListener('click', this.clearAll);
    preserve.addEventListener('change', this.onPreserveChange);
    filter.addEventListener('input', this.onFilterInput);
    document.addEventListener('keydown', this.onArrowKey);
    // DevTools closing: put the page's fetch/XHR back while we still can (the
    // page also retires the wrapper by itself; see pending-capture.ts).
    window.addEventListener('pagehide', this.onPageHide);
    chrome.devtools.network.onRequestFinished.addListener(this.onRequestFinished);
    chrome.devtools.network.onNavigated.addListener(this.onNavigated);
    this.detail.start();
    // Ctrl+Shift+A: scroll to the newest row, pulse it, and focus the filter.
    this.unwatchFocus = watchFocusFlag('ad', this.focusNewest);
    // Origin, site list and cache must be in place before the first resolve,
    // so backfill waits for them: a warm cache then paints names on the very
    // first frame instead of after a round-trip.
    void this.ready.then(() => {
      if (runId === this.runId) this.backfillFromHar();
    });
  }

  /**
   * Undo start(): every listener, timer, poll and watcher; cache writes still
   * waiting for their debounce are written now. The rows stay.
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.runId++;

    const { record, clear, preserve, filter } = this.els;
    record.removeEventListener('click', this.onRecordClick);
    clear.removeEventListener('click', this.clearAll);
    preserve.removeEventListener('change', this.onPreserveChange);
    filter.removeEventListener('input', this.onFilterInput);
    document.removeEventListener('keydown', this.onArrowKey);
    window.removeEventListener('pagehide', this.onPageHide);
    chrome.devtools.network.onRequestFinished.removeListener(this.onRequestFinished);
    chrome.devtools.network.onNavigated.removeListener(this.onNavigated);
    this.detail.stop();
    this.pending.stop();
    this.queue.stop();
    this.unwatchFocus?.();
    this.unwatchFocus = null;
    this.unwatchSite?.();
    this.unwatchSite = null;
    this.openQueue.stop();
    this.status.stop();
    this.flash.cancel();
    void this.cache.flush();
  }

  // ---- toolbar and browser events -------------------------------------------

  private readonly onRecordClick = (): void => {
    const record = this.els.record;
    this.recording = !this.recording;
    record.classList.toggle('on', this.recording);
    const label = record.querySelector('.dot')?.nextSibling;
    if (label) label.textContent = this.recording ? ' Recording' : ' Paused';
  };

  private readonly onPageHide = (): void => {
    this.stop();
  };

  private readonly onPreserveChange = (): void => {
    this.preserveLog = this.els.preserve.checked;
  };

  private readonly onFilterInput = (): void => {
    this.filterText = this.els.filter.value.trim().toLowerCase();
    for (const row of this.rows) this.applyRowFilter(row);
  };

  private readonly onRequestFinished = (req: chrome.devtools.network.Request): void => {
    this.onRequest(req as unknown as HarEntry);
  };

  // A navigation may have taken the tab to another site. At once, before
  // anything else can act on the old page's behalf: the inspected origin is
  // unknown (so not allowed), every header and token learned is forgotten,
  // and capture and lookups stop. Once detect() answers for the new page,
  // applySiteAccess() decides afresh what the panel may do there.
  private readonly onNavigated = (): void => {
    const runId = this.runId;
    this.site.forget();
    this.resolver.forgetAuth();
    this.pending.stop();
    this.queue.stop();
    if (!this.preserveLog) this.clearAll();
    this.ready = this.ready.then(async () => {
      await this.site.detect();
      if (runId !== this.runId) return;
      this.applySiteAccess();
    });
  };

  /**
   * Act on the inspected page only while it is on an allowed site: patch its
   * fetch/XHR for in-flight rows, and look names up. Anywhere else, put the
   * page's fetch back and say why names are missing.
   */
  private readonly applySiteAccess = (): void => {
    if (!this.started) return;
    if (this.site.isAllowed && this.site.apiOrigin) {
      this.pending.start(this.site.apiOrigin);
      this.status.setOffline(false);
      for (const row of this.rows) this.queue.add(row.uuid);
    } else {
      this.pending.stop();
      this.queue.stop();
      this.resolver.forgetAuth();
      if (this.site.apiOrigin) this.status.setOffline(true, 'this page is not on an allowed site');
    }
  };

  // ---- capture -------------------------------------------------------------

  // Backfill from the browser's own capture. DevTools defers loading
  // panel.html until the user first clicks our tab, so any AD chain request
  // fired between "DevTools opened" and "user picked AD Network" would
  // otherwise be lost. getHAR() reads the same log the built-in Network tab
  // uses, so this closes the gap and matches the Network tab's ordering.
  private backfillFromHar(): void {
    try {
      chrome.devtools.network.getHAR((harLog) => {
        if (!this.started || !harLog || !Array.isArray(harLog.entries)) return;
        const sorted = (harLog.entries as HarEntry[]).slice().sort((a, b) => startedAt(a) - startedAt(b));
        for (const har of sorted) this.onRequest(har);
      });
    } catch (err) {
      // getHAR unavailable: the live listener still catches everything from now on.
      log.warn('cannot backfill from the HAR log:', err);
    }
  }

  onRequest(har: HarEntry): void {
    if (!this.recording) return;
    const req = har?.request;
    const info = req ? classifyChainUrl(req.url) : null;
    if (!info) return;

    const key = harKey(har);
    if (this.seen.has(key)) return;
    this.seen.add(key);

    // Every observed chain request is a chance to learn the app's auth
    // headers, which is what lets us query the platform for names ourselves.
    // The resolver keeps them for that request's origin, on allowed sites only.
    this.resolver.rememberAuth(har);
    const allowed = this.site.isAllowed;

    const status = har.response?.status || 0;
    const row: Row = {
      id: this.nextId++,
      uuid: info.uuid,
      kind: info.kind,
      version: info.version,
      httpMethod: req.method || '—',
      url: req.url,
      status,
      statusGroup: statusGroup(status),
      type: typeOf(har),
      size: transferSize(har),
      time: typeof har.time === 'number' ? har.time : -1,
      startedAt: startedAt(har),
      har,
      rowEl: null,
      nameCell: null,
      categoryCell: null
    };

    // Follow the tail like the real Network tab if already scrolled to bottom
    // AND the new row is being appended at the end (it started after
    // everything already visible). Backfilled rows inserted mid-list must not
    // jump the scroll.
    const pane = this.els.listPane;
    const atBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4;
    const insertAt = this.insertIndexFor(row.startedAt);
    const isAppend = insertAt === this.rows.length;
    this.rows.splice(insertAt, 0, row);
    this.renderRow(row, insertAt);
    if (atBottom && isAppend) pane.scrollTop = pane.scrollHeight;

    // Name: definition fetches carry it in their body — show it at once.
    // Only shown: the category and routing still come from the platform, so
    // the uuid is looked up (and cached) like any other. HAR entries from
    // getHAR() lack a working getContent().
    if (allowed && info.kind === 'fetch' && typeof har.getContent === 'function') {
      try {
        har.getContent((body: string) => {
          const name = extractMethodNameFromChainResponse(body || '');
          if (name) this.names.learnName(info.uuid, name);
        });
      } catch {
        /* backfill entries: no content available */
      }
    }
    // Name (for execute) + category for every row come from the platform,
    // asked only on an allowed site.
    if (allowed) this.queue.add(info.uuid);

    // Cap the table — drop the oldest rows.
    while (this.rows.length > MAX_ROWS) {
      const old = this.rows.shift()!;
      this.seen.delete(harKey(old.har));
      old.rowEl?.remove();
      if (this.detail.selected === old) this.detail.close();
    }
    // After the trim, so the numbers start at 1 even once rows were dropped.
    this.renumberRows();
    this.els.count.textContent = String(this.rows.length);
  }

  // Find the chronological insert index for a new row. rows[] is kept sorted
  // by start time ascending. The comparison is strict (`>`), so rows sharing a
  // millisecond keep their arrival order rather than churning.
  private insertIndexFor(started: number): number {
    let i = this.rows.length;
    while (i > 0 && this.rows[i - 1]!.startedAt > started) i--;
    return i;
  }

  private renumberRows(): void {
    this.rows.forEach((row, i) => {
      const cell = row.rowEl?.firstChild;
      if (cell) cell.textContent = String(i + 1);
    });
  }

  private readonly clearAll = (): void => {
    this.rows.length = 0;
    this.seen.clear();
    this.els.rows.replaceChildren();
    this.els.pendingRows.replaceChildren();
    this.pendingRows.clear();
    this.els.count.textContent = '0';
    this.els.empty.classList.remove('hidden');
    this.detail.close();
  };

  // ---- rows ----------------------------------------------------------------

  private renderRow(row: Row, insertAt: number): void {
    this.els.empty.classList.add('hidden');

    // # cell text is set by renumberRows() after insertion; placeholder here.
    const srCell = el('td', { className: 'sr' }, '');
    // Clicking name or category opens the request-details pane (via the
    // row-level handler below). Only the Actions "Open in draft" button opens the designer.
    const nameCell = el('td', null);
    const categoryCell = el('td', null);
    row.nameCell = nameCell;
    row.categoryCell = categoryCell;

    const actionsCell = el(
      'td',
      { className: 'actions' },
      iconButton(ICON_COPY, 'Copy as cURL', (btn) => {
        navigator.clipboard.writeText(buildCurl(row.har)).then(() => flashOk(btn), () => {});
      }),
      iconButton(ICON_LINK, 'Copy Slack link', (btn) => this.copySlackLink(row, btn)),
      iconButton(ICON_OPEN, 'Open in draft (background tab)', (btn) => {
        this.enqueueOpen(row);
        flashOk(btn);
      })
    );

    const statusText = row.status ? String(row.status) : row.statusGroup === 'error' ? 'canceled' : '—';
    const statusCell = el('td', null, el('span', { className: 'sbadge ' + row.statusGroup }, statusText));
    const httpCell = el('td', { className: 'dim' }, row.httpMethod);
    const badge = el(
      'span',
      { className: 'badge ' + (row.kind === 'execute' ? 'run' : 'get') },
      row.kind === 'execute' ? 'RUN' : 'GET'
    );
    const kindCell = el('td', { className: 'dim' }, badge, ' ' + row.version);

    const idCell = el('td', { className: 'mono', title: row.uuid + '  ·  click to copy' }, row.uuid);
    idCell.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(row.uuid).then(() => flashText(idCell, 'copied'), () => {});
    });

    const typeCell = el('td', { className: 'dim' }, row.type);
    const sizeCell = el('td', { className: 'dim' }, formatBytes(row.size));
    const timeCell = el('td', { className: 'dim' }, row.time >= 0 ? Math.round(row.time) + ' ms' : '—');

    const tr = el(
      'tr',
      null,
      srCell, nameCell, categoryCell, actionsCell, statusCell, httpCell,
      kindCell, idCell, typeCell, sizeCell, timeCell
    );
    tr.addEventListener('click', () => this.select(row));

    row.rowEl = tr;
    this.paintName(row);
    this.paintCategory(row);
    this.applyRowFilter(row);

    // Mirror the array order in the DOM. Scan forward for the first row that
    // actually has a live element to anchor against — stopping at the
    // immediate successor would fall through to appendChild (jumping the row
    // to the bottom of the table) whenever that one row was unrendered.
    let anchor: HTMLTableRowElement | null = null;
    for (let i = insertAt + 1; i < this.rows.length; i++) {
      const candidate = this.rows[i]!.rowEl;
      if (candidate && candidate.parentNode === this.els.rows) {
        anchor = candidate;
        break;
      }
    }
    this.els.rows.insertBefore(tr, anchor);
  }

  /** A name or category was learned: repaint every row, and the pane, showing it. */
  private repaint(uuid: string): void {
    for (const row of this.rows) {
      if (row.uuid !== uuid) continue;
      this.paintName(row);
      this.paintCategory(row);
      this.applyRowFilter(row);
    }
    this.detail.refreshIf(uuid);
  }

  private paintName(row: Row): void {
    const cell = row.nameCell;
    if (!cell) return;
    const name = this.names.name(row.uuid);
    cell.className = 'name s-' + row.statusGroup + (name ? '' : ' pending');
    cell.textContent = name || row.uuid.slice(0, 12) + '…';
    cell.title = name ? name + '  ·  click to see details' : row.uuid + '  (resolving…)';
  }

  private paintCategory(row: Row): void {
    const cell = row.categoryCell;
    if (!cell) return;
    const category = this.names.category(row.uuid);
    cell.className = category ? 'category' : 'category pending';
    cell.textContent = category || '…';
    cell.title = category ? category + '  ·  click to see details' : '';
  }

  private rowMatches(row: Row): boolean {
    const q = this.filterText;
    if (!q) return true;
    return (
      (this.names.name(row.uuid) || '').toLowerCase().includes(q) ||
      (this.names.category(row.uuid) || '').toLowerCase().includes(q) ||
      row.uuid.includes(q) ||
      row.url.toLowerCase().includes(q)
    );
  }

  private applyRowFilter(row: Row): void {
    row.rowEl?.classList.toggle('hidden', !this.rowMatches(row));
  }

  private select(row: Row): void {
    this.markSelected(row);
    this.detail.show(row);
  }

  private markSelected(selected: Row | null): void {
    for (const row of this.rows) row.rowEl?.classList.toggle('selected', row === selected);
  }

  // Arrow-key navigation across visible rows.
  private readonly onArrowKey = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    const visible = this.rows.filter((row) => row.rowEl && !row.rowEl.classList.contains('hidden'));
    if (visible.length === 0) return;
    e.preventDefault();
    let idx = visible.findIndex((row) => row === this.detail.selected);
    if (e.key === 'ArrowDown') idx = idx < 0 ? 0 : Math.min(idx + 1, visible.length - 1);
    else idx = idx < 0 ? 0 : Math.max(idx - 1, 0);
    const target = visible[idx];
    if (!target) return;
    this.select(target);
    target.rowEl?.scrollIntoView({ block: 'nearest' });
  };

  private readonly focusNewest = (): void => {
    this.els.listPane.scrollTop = this.els.listPane.scrollHeight;
    const row = this.rows[this.rows.length - 1]?.rowEl;
    if (row) this.flash.show(row);
    this.els.filter.focus();
  };

  // ---- in-flight rows ------------------------------------------------------
  // chrome.devtools.network only fires onRequestFinished — a slow or hung
  // request is invisible in our panel while it's alive. PendingCapture reports
  // live requests; they render as a separate "in-flight" block below the
  // finished rows. When a request completes it drops out of the pending list
  // and shows up as a finished row via onRequestFinished.

  private updatePending(entries: PendingEntry[]): void {
    const currentIds = new Set(entries.map((e) => e.id));
    for (const [id, tr] of this.pendingRows) {
      if (currentIds.has(id)) continue;
      tr.remove();
      this.pendingRows.delete(id);
    }
    for (const entry of entries) {
      if (this.pendingRows.has(entry.id)) continue;
      const tr = renderPendingRow(entry);
      this.pendingRows.set(entry.id, tr);
      this.els.pendingRows.appendChild(tr);
    }
  }

  // ---- row actions ---------------------------------------------------------

  /**
   * Look a row's method up (cache first) and build its designer URL. Rejects
   * when it cannot be opened: not an allowed site, unknown on this instance,
   * or no category or draft to route to (noDesignerUrlReason).
   */
  private async lookUp(row: Row): Promise<{ summary: MethodSummary | null; url: string }> {
    await this.ready;
    const summary = await this.resolver.resolveSummary(row.uuid, (fresh) => this.names.apply(row.uuid, fresh));
    const url = this.resolver.buildDesignerUrl(row.uuid, summary);
    if (!url) throw new Error(noDesignerUrlReason(summary));
    return { summary, url };
  }

  /** A lookup succeeded: paint what it found, and clear the offline pill. */
  private found(row: Row, summary: MethodSummary | null): void {
    this.names.apply(row.uuid, summary);
    this.status.setOffline(false);
  }

  // Copy a Slack-pasteable rich link to the method's designer page — mirrors
  // the Shift+L "copy AD rich link" feature on AD pages.
  private async copySlackLink(row: Row, btn: HTMLButtonElement): Promise<void> {
    const runId = this.runId;
    try {
      const { summary, url } = await this.lookUp(row);
      if (runId !== this.runId) return;
      this.found(row, summary);
      const name = summary?.name || this.names.name(row.uuid) || shortUuid(row.uuid);
      const category = summary?.category || this.names.category(row.uuid) || '';
      const label = [category, name].filter(Boolean).join('::');
      await copyRichLink(label, url);
      if (runId !== this.runId) return;
      flashOk(btn);
      this.status.toast('copied link · ' + label);
    } catch (err) {
      if (runId !== this.runId) return;
      this.status.setOffline(true, errorText(err));
      this.status.toast('could not copy link — ' + lookupFailure(err));
    }
  }

  // "Open in draft": opens the method's draft designer page, with inputs
  // autofilled, in a BACKGROUND tab — the user stays where they are.
  private enqueueOpen(row: Row): void {
    this.openQueue.add(row);
    const waiting = this.openQueue.size;
    this.status.toast(
      'queued ' + (this.names.name(row.uuid) || shortUuid(row.uuid)) +
        (waiting ? ' · ' + waiting + ' in queue' : '')
    );
  }

  /** One queued open. Does nothing more once the panel stopped (`isCurrent`). */
  private async openInDraft(row: Row, isCurrent: () => boolean): Promise<void> {
    try {
      const { summary, url } = await this.lookUp(row);
      if (!isCurrent()) return;
      this.found(row, summary);
      const target = await withAutofill(url, row.har);
      if (!isCurrent()) return;
      await openInBackgroundTab(target);
      if (!isCurrent()) return;
      const remaining = this.openQueue.size;
      this.status.toast(
        'opening ' + (summary?.name || shortUuid(row.uuid)) + ' in draft' +
          (remaining ? ' · ' + remaining + ' queued' : '')
      );
    } catch (err) {
      if (!isCurrent()) return;
      this.status.setOffline(true, errorText(err));
      this.status.toast('could not open ' + shortUuid(row.uuid) + ' — ' + lookupFailure(err));
    }
  }
}

function renderPendingRow(entry: PendingEntry): HTMLTableRowElement {
  return el(
    'tr',
    { className: 'pending-row' },
    el('td', { className: 'sr' }, ''),
    el('td', { className: 'name pending' }, shortUuidFromUrl(entry.url) || entry.url),
    el('td', { className: 'category pending' }, '…'),
    el('td', { className: 'actions' }),
    el('td', null, el('span', { className: 'sbadge pending' }, 'pending')),
    el('td', { className: 'dim' }, entry.method || '—'),
    el('td', { className: 'dim' }, ''),
    el('td', { className: 'mono dim' }, entry.url.replace(/^https?:\/\/[^/]+/, '')),
    el('td', { className: 'dim' }, ''),
    el('td', { className: 'dim' }, ''),
    el('td', { className: 'dim' }, 'in flight')
  );
}
