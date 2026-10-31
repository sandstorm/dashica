// See exploreView in explore-view.ts.
import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { Memento } from '../../hosts/extension-host/extension-host';
import type { PageContext } from '../../hosts/page/page';
import type { QueryApi } from '../../hosts/query/query';
import { initialView, type InitialView, type ViewerConfig } from './mapping';
import { describeRows, fetchRows, fetchSql, rowsRequest, sqlRequest, type RowsAnswer } from './rows';

/** Perspective as the view uses it, from the lazily loaded module (perspective.ts). */
export interface Perspective {
  /** The page's one client of the engine in a Web Worker. */
  worker(): Promise<PerspectiveClient>;
  /** A new `<perspective-viewer>` with the datagrid and the charts; once `worker()` resolved, which defines it. */
  createViewer(doc: Document): PerspectiveViewer;
}

export interface PerspectiveClient {
  /** A table of the Arrow IPC stream `arrow`. */
  table(arrow: ArrayBuffer): Promise<PerspectiveTable>;
}

export interface PerspectiveTable {
  /** Swaps the rows for those of `arrow`, the same columns; the viewer on it keeps its config. */
  replace(arrow: ArrayBuffer): Promise<void>;
  /** The columns by name, each with its Perspective type (`string`, `integer`, `float`, `boolean`, `date`, `datetime`). */
  schema(): Promise<Record<string, string>>;
  size(): Promise<number>;
  delete(): Promise<void>;
}

export interface PerspectiveViewer extends HTMLElement {
  load(table: PerspectiveTable): Promise<unknown>;
  restore(config: ViewerConfig): Promise<void>;
  save(): Promise<ViewerConfig>;
  /** Back to no config; `all`: the plugin's settings too. */
  reset(all?: boolean): Promise<unknown>;
  delete(): Promise<unknown>;
}

/** A value the viewer clicked on a group row, which the page can filter by. */
export interface ViewSelection {
  /** The clicked row's column (`host`), the id of a filter on it. */
  readonly fieldId: string;
  readonly value: string;
  /** Where the click was; in the page while the view is. */
  readonly anchor: Element;
}

/** A chart that serves its rows to the view: its result, and the rows of its SQL as the viewer edited it. */
export type ChartWithRows = Extract<WidgetNode, { rowsUrl?: string }> & { readonly rowsUrl: string };

export interface ExploreViewOptions {
  /** The chart whose rows the view shows. */
  readonly widget: ChartWithRows;
  readonly query: QueryApi;
  /** Keeps the viewer's config per chart and mode for this viewer (`stateKey`). */
  readonly state: Memento;
  readonly perspective: () => Promise<Perspective>;
  /** The tab's hash (`#explore=3`, `#explore=3&xsql=…` while the SQL is edited), as it is now. */
  hash(): string;
  /** Fires when the tab's hash changed (Run, Reset, back and forward). */
  readonly onDidChangeHash: PageContext['onDidChangeHash'];
  /** Goes to `hash` in the tab, a new entry of its history (`#explore=3&xsql=…`). */
  navigate(hash: string): void;
  /** The view's "Close". */
  close(): void;
  /** A click on a group row's value (`perspective-click`). */
  select(selection: ViewSelection): void;
}

/**
 * Fills `el` with the Explore view of `options.widget` until disposed: a bar (title, "24 rows of the chart's result",
 * the chart's Diagnostics, "SQL" closing and opening the editor when the answer allows editing, else a note that it
 * is off, "Reset", "Close"), the SQL editor (open from the start), the notes of the config mapping, and
 * `<perspective-viewer>`. Following the chart (no `xsql` in the tab's hash) it shows the chart's result
 * with the page's query state and the editor the chart's SQL with that state written in, both fetched again on each
 * `onDidRequestRefresh`. Run puts the editor's text into the hash (`xsql`): the view then shows that SQL's rows, which
 * the page's time range and filters do not change, until "Reset to the chart's query". It keeps the config the viewer
 * changed per chart and mode; "Reset" goes back to the chart's.
 */
export function renderExploreView(el: HTMLElement, options: ExploreViewOptions): Disposable {
  const view = new ExploreView(el, options);
  return new Disposable(() => view.dispose());
}

/** What the view calls `widget`: its title, else its type. */
export function chartTitle(widget: WidgetNode): string {
  return 'title' in widget.props && widget.props.title ? widget.props.title : widget.type;
}

/** The key of `widget`'s viewer config in the view's state, on its result or (`edited`) the rows of an edited query. */
export function stateKey(widget: { readonly dataUrl: string }, edited = false): string {
  return edited ? `view:${widget.dataUrl}:edited` : `view:${widget.dataUrl}`;
}

/** The SQL the tab's hash `hash` holds (`#explore=3&xsql=…`); `undefined` while the view follows the chart. */
export function editedSql(hash: string): string | undefined {
  return new URLSearchParams(hash.replace(/^#/, '')).get('xsql') ?? undefined;
}

/** `hash` with the edited SQL `sql` (`xsql`), or without one for `undefined`; its other keys kept. */
export function withEditedSql(hash: string, sql: string | undefined): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (sql === undefined) params.delete('xsql');
  else params.set('xsql', sql);
  return `#${params}`;
}

/** What the viewer's config keeps across visits: without the table's name (new per visit), its theme and title. */
export function persistable(config: ViewerConfig): ViewerConfig {
  const { table: _table, theme: _theme, title: _title, ...kept } = config;
  return kept;
}

class ExploreView {
  readonly #status: HTMLElement = html`<span class="d-explore-view__status"></span>`;
  readonly #ignored: HTMLElement = html`<span class="d-badge" hidden></span>`;
  readonly #sqlButton: HTMLButtonElement = html`<button class="d-button" type="button" aria-pressed="true" hidden data-testid="explore-view-sql">SQL</button>`;
  readonly #sqlOff: HTMLElement = html`<span class="d-explore-view__status" hidden data-testid="explore-view-sql-off">SQL editing is off (explore.enabled)</span>`;
  readonly #sqlText: HTMLTextAreaElement = html`<textarea
    class="d-field d-field--full d-field--mono d-explore-view__sql-text"
    rows="8"
    spellcheck="false"
    aria-label="SQL"
    data-testid="explore-view-sql-text"></textarea>`;
  readonly #sqlNote: HTMLElement = html`<span class="d-explore-view__status" data-testid="explore-view-sql-note"></span>`;
  readonly #sqlError: HTMLElement = html`<div class="d-notice d-notice--error" hidden></div>`;
  readonly #sqlPanel: HTMLElement = html`<div class="d-explore-view__sql" hidden data-testid="explore-view-sql-panel"></div>`;
  readonly #editedNote: HTMLElement = html`<div class="d-notice d-explore-view__edited" hidden data-testid="explore-view-edited"></div>`;
  readonly #notes: HTMLElement = html`<ul class="d-explore-view__notes" hidden></ul>`;
  readonly #body: HTMLElement = html`<div class="d-explore-view__body"></div>`;
  readonly #message: HTMLElement = html`<div class="d-explore-view__message"><span class="d-spinner"></span></div>`;
  readonly #listening: Disposable;
  #loading: AbortController | undefined;
  #disposed = false;
  #shown: { viewer: PerspectiveViewer; table: PerspectiveTable; schema: Record<string, string> } | undefined;
  /** The rows being shown; the next rows wait for it, so one viewer and table come of loads that overlap. */
  #showing: Promise<void> = Promise.resolve();
  /** The viewer was used (a press or a key in it): its config changes are the viewer's own, kept. */
  #touched = false;
  /** The SQL the view shows the rows of (the tab's hash's `xsql`); `undefined`: the chart's result. */
  #edited: string | undefined;
  /** The chart's SQL as last fetched, written into the editor; `undefined` before. */
  #materialized: string | undefined;
  #loadingSql: AbortController | undefined;
  /** The editor is open, as "SQL" toggles it; it shows once the server allows editing (`#sqlAllowed`) or while edited. */
  #sqlOpen = true;
  #sqlAllowed = false;
  #pointer = { x: 0, y: 0 };

  constructor(
    private readonly el: HTMLElement,
    private readonly options: ExploreViewOptions,
  ) {
    const title = chartTitle(options.widget);
    const reset: HTMLButtonElement = html`<button class="d-button" type="button" data-testid="explore-view-reset">Reset</button>`;
    const close: HTMLButtonElement = html`<button class="d-button" type="button" data-testid="explore-view-close">Close</button>`;
    reset.onclick = () => void this.#reset();
    close.onclick = () => options.close();
    this.#sqlButton.onclick = () => this.#setSqlOpen(!this.#sqlOpen);
    const run: HTMLButtonElement = html`<button class="d-button d-button--primary" type="button" data-testid="explore-view-run">Run</button>`;
    run.onclick = () => this.#run();
    this.#sqlText.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.#run();
      }
    });
    this.#sqlText.addEventListener('input', () => this.#showSqlNote());
    const backToChart = () => options.navigate(withEditedSql(options.hash(), undefined));
    const resetSql: HTMLButtonElement = html`<button class="d-button" type="button" data-testid="explore-view-sql-reset">Reset to the chart’s query</button>`;
    resetSql.onclick = backToChart;
    this.#editedNote.append('Edited query: the page’s time range and filters do not apply. ', resetSql);
    this.#sqlPanel.append(this.#sqlText, html`<div class="d-explore-view__sql-bar">${run}${this.#sqlNote}</div>`, this.#sqlError);
    el.replaceChildren(html`<div class="d-explore-view" data-testid="explore-view">
      <div class="d-explore-view__bar">
        <h2 class="d-explore-view__title">Explore: ${title}</h2>
        ${this.#status}${this.#ignored}${this.#sqlOff}
        <span class="d-explore-view__actions">${this.#sqlButton}${reset}${close}</span>
      </div>
      ${this.#sqlPanel}${this.#editedNote}${this.#notes}${this.#body}
    </div>`);
    this.#body.append(this.#message);
    this.#edited = editedSql(options.hash());
    this.#showEdited();
    // the page's colour scheme, followed while the view is open
    const scheme = el.ownerDocument.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    const restyle = () => void this.#shown?.viewer.restore({ theme: this.#theme() });
    scheme?.addEventListener('change', restyle);
    this.#listening = Disposable.from(
      options.query.onDidRequestRefresh(() => void this.#load()),
      options.onDidChangeHash(() => this.#hashChanged()),
      { dispose: () => scheme?.removeEventListener('change', restyle) },
    );
    void this.#load();
  }

  dispose(): void {
    this.#disposed = true;
    this.#loading?.abort();
    this.#loadingSql?.abort();
    this.#listening.dispose();
    void this.#shown?.viewer.delete().then(() => this.#shown?.table.delete());
    this.el.replaceChildren();
  }

  /**
   * Fetches the rows, the chart's result with the page's query state or the edited SQL's, then shows them; following
   * the chart with the editor open, its SQL too.
   */
  async #load(): Promise<void> {
    this.#loading?.abort();
    const loading = new AbortController();
    this.#loading = loading;
    this.#status.textContent = 'loading…';
    const { widget, query } = this.options;
    const params = query.requestParams();
    if (this.#edited === undefined && !this.#sqlPanel.hidden) void this.#loadSql();
    let answer: RowsAnswer;
    try {
      answer = await fetchRows(rowsRequest(widget.rowsUrl, params, this.#edited), loading.signal);
    } catch (error) {
      if (!loading.signal.aborted) this.#showMessage(error, 'error');
      return;
    }
    if (loading.signal.aborted) return;
    this.#sqlAllowed = answer.sqlEditable;
    this.#showSqlPanel();
    const ignored = answer.diagnostics.ignored ?? [];
    this.#ignored.hidden = ignored.length === 0;
    this.#ignored.textContent = `ignores ${ignored.join(', ')}`;
    if (!answer.arrow) {
      this.#showMessage(`skipped: ${answer.diagnostics.skipped ?? 'no rows'}`, 'notice');
      return;
    }
    try {
      await this.#show(answer.arrow, loading.signal);
      if (loading.signal.aborted || !this.#shown) return;
      this.#status.textContent = describeRows(answer, await this.#shown.table.size());
    } catch (error) {
      if (!loading.signal.aborted) this.#showMessage(error, 'error');
    }
  }

  /** Shows `arrow` after the rows shown before, unless a later load or the view's end came first. */
  #show(arrow: ArrayBuffer, signal: AbortSignal): Promise<void> {
    const showing = this.#showing.then(() => (signal.aborted || this.#disposed ? undefined : this.#showNow(arrow, signal)));
    this.#showing = showing.catch(() => undefined);
    return showing;
  }

  /**
   * Shows `arrow`: into the table shown (the viewer keeps its config), else a new table and viewer with the saved or
   * the chart's config. A table made when the load was stopped meanwhile is deleted unshown.
   */
  async #showNow(arrow: ArrayBuffer, signal: AbortSignal): Promise<void> {
    const stale = () => signal.aborted || this.#disposed;
    if (this.#shown) {
      try {
        await this.#shown.table.replace(arrow);
        return;
      } catch {
        // other columns than before: a new table under the viewer's config
        const config = persistable(await this.#shown.viewer.save());
        const old = this.#shown.table;
        const table = await (await (await this.options.perspective()).worker()).table(arrow);
        const schema = await table.schema();
        if (stale() || !this.#shown) {
          await table.delete();
          return;
        }
        this.#shown = { ...this.#shown, table, schema };
        await this.#shown.viewer.load(table);
        await this.#restore(config);
        await old.delete();
        return;
      }
    }
    const perspective = await this.options.perspective();
    const table = await (await perspective.worker()).table(arrow);
    const schema = await table.schema();
    if (stale()) {
      await table.delete();
      return;
    }
    const viewer = perspective.createViewer(this.el.ownerDocument);
    viewer.classList.add('d-explore-view__viewer');
    this.#shown = { viewer, table, schema };
    this.#message.remove();
    this.#body.append(viewer);
    this.#listen(viewer);
    await viewer.load(table);
    await this.#restore(this.options.state.get<ViewerConfig>(stateKey(this.options.widget, this.#edited !== undefined)));
  }

  /**
   * Fetches the chart's SQL with the page's query state into the editor; a draft (a text that differs from the SQL
   * fetched before) stays. Its error shows below the editor.
   */
  async #loadSql(): Promise<void> {
    this.#loadingSql?.abort();
    const loading = new AbortController();
    this.#loadingSql = loading;
    let sql: string;
    try {
      sql = await fetchSql(sqlRequest(this.options.widget.dataUrl, this.options.query.requestParams()), loading.signal);
    } catch (error) {
      if (loading.signal.aborted) return;
      this.#sqlError.hidden = false;
      this.#sqlError.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    if (loading.signal.aborted || this.#edited !== undefined) return;
    this.#sqlError.hidden = true;
    const draft = this.#sqlText.value !== (this.#materialized ?? '') && this.#sqlText.value !== '';
    this.#materialized = sql;
    if (!draft) this.#sqlText.value = sql;
    this.#showSqlNote();
  }

  #setSqlOpen(open: boolean): void {
    this.#sqlOpen = open;
    this.#showSqlPanel();
  }

  /** Shows the editor while it is open and editing is allowed or the hash holds an edit; on showing, the chart's SQL. */
  #showSqlPanel(): void {
    const allowed = this.#sqlAllowed || this.#edited !== undefined;
    const wasHidden = this.#sqlPanel.hidden;
    this.#sqlButton.hidden = !allowed;
    this.#sqlButton.setAttribute('aria-pressed', String(this.#sqlOpen));
    this.#sqlOff.hidden = allowed;
    this.#sqlPanel.hidden = !(allowed && this.#sqlOpen);
    if (wasHidden && !this.#sqlPanel.hidden && this.#edited === undefined) void this.#loadSql();
  }

  /** Run: the editor's text into the tab's hash; the chart's SQL as fetched last follows the chart again. */
  #run(): void {
    const text = this.#sqlText.value;
    const following = this.#edited === undefined && text === this.#materialized;
    this.options.navigate(withEditedSql(this.options.hash(), following ? undefined : text));
  }

  /** Shows what the hash says: the editor and the note while edited, the editor's text the hash's. */
  #showEdited(): void {
    const edited = this.#edited !== undefined;
    this.#editedNote.hidden = !edited;
    if (edited) {
      this.#sqlText.value = this.#edited!;
      this.#setSqlOpen(true);
    } else if (this.#materialized !== undefined) this.#sqlText.value = this.#materialized;
    this.#showSqlNote();
  }

  /** "not run" while the editor's text is not the SQL whose rows are shown. */
  #showSqlNote(): void {
    const shown = this.#edited ?? this.#materialized;
    this.#sqlNote.textContent = shown !== undefined && this.#sqlText.value !== shown ? 'not run' : '';
  }

  /**
   * The tab's hash changed (or a Run went to the same one): the rows of the SQL it names, in a new viewer when it went
   * from or to the chart's result.
   */
  #hashChanged(): void {
    const edited = editedSql(this.options.hash());
    const otherRows = (edited === undefined) !== (this.#edited === undefined);
    if (edited !== this.#edited) {
      this.#edited = edited;
      this.#showEdited();
    }
    if (!otherRows) {
      void this.#load();
      return;
    }
    this.#touched = false;
    this.#loading?.abort();
    // after the rows being shown, so that no viewer of the other rows stays
    this.#showing = this.#showing.then(() => this.#dropViewer());
    this.#body.replaceChildren(this.#message);
    this.#message.className = 'd-explore-view__message';
    this.#message.replaceChildren(html`<span class="d-spinner"></span>`);
    void this.#load();
  }

  /** Restores `saved`, else (or when it fails) the chart's config, and shows the mapping's notes. */
  async #restore(saved: ViewerConfig | undefined): Promise<void> {
    const initial = this.#initial();
    const notes = [...initial.notes];
    if (saved) {
      try {
        await this.#shown!.viewer.restore({ ...saved, theme: this.#theme() });
        this.#showNotes(notes);
        return;
      } catch (error) {
        notes.push(`the kept view does not fit these rows (${error instanceof Error ? error.message : String(error)}); shown as the chart`);
      }
    }
    await this.#shown!.viewer.restore({ ...initial.config, theme: this.#theme() });
    this.#showNotes(notes);
  }

  /**
   * Perspective's theme for the page's colour scheme (tokens.css follows `prefers-color-scheme`): a theme's name, as the
   * viewer's config documents `theme`; both themes' stylesheets are loaded with Perspective (perspective.ts).
   */
  #theme(): string {
    return this.el.ownerDocument.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'Pro Dark' : 'Pro Light';
  }

  /** "Reset": the chart's config, the kept one forgotten. */
  async #reset(): Promise<void> {
    if (!this.#shown) return;
    this.#touched = false;
    await this.options.state.update(stateKey(this.options.widget, this.#edited !== undefined), undefined);
    await this.#shown.viewer.reset(true);
    await this.#restore(undefined);
  }

  #initial(): InitialView {
    return initialView(this.options.widget, { kind: this.#edited !== undefined ? 'edited' : 'result', columns: Object.keys(this.#shown?.schema ?? {}) });
  }

  #listen(viewer: PerspectiveViewer): void {
    const touch = () => (this.#touched = true);
    viewer.addEventListener('keydown', touch);
    viewer.addEventListener('pointerdown', (event: PointerEvent) => {
      touch();
      this.#pointer = { x: event.clientX, y: event.clientY };
    });
    viewer.addEventListener('perspective-config-update', (event: Event) => {
      if (!this.#touched) return;
      const { getConfig } = (event as CustomEvent<{ getConfig(): ViewerConfig }>).detail;
      void this.options.state.update(stateKey(this.options.widget, this.#edited !== undefined), persistable(getConfig()));
    });
    viewer.addEventListener('perspective-click', (event: Event) => {
      const selection = this.#clicked((event as CustomEvent<{ config?: ViewerConfig }>).detail);
      if (selection) this.options.select(selection);
    });
  }

  /**
   * The value a click on a group row selects: the deepest of its group filters (`[column, '==', value]`) on a column
   * of the rows that is no date or time; `undefined` for any other click, and for every click on the rows of an edited
   * query: their columns are whatever its text selects, and a page filter does not change the edited query.
   */
  #clicked(detail: { config?: ViewerConfig } | undefined): ViewSelection | undefined {
    if (this.#edited !== undefined) return undefined;
    const schema = this.#shown?.schema ?? {};
    const filters = (detail?.config?.filter ?? []).filter(
      ([column, op, value]) => op === '==' && value != null && column in schema && schema[column] !== 'date' && schema[column] !== 'datetime',
    );
    const last = filters.at(-1);
    if (!last) return undefined;
    const box = this.#body.getBoundingClientRect();
    const anchor: HTMLElement = html`<span class="d-explore-view__anchor"></span>`;
    anchor.style.left = `${this.#pointer.x - box.left}px`;
    anchor.style.top = `${this.#pointer.y - box.top}px`;
    this.#body.querySelector('.d-explore-view__anchor')?.remove();
    this.#body.append(anchor);
    return { fieldId: last[0], value: String(last[2]), anchor };
  }

  #showNotes(notes: readonly string[]): void {
    this.#notes.replaceChildren(...notes.map((note) => html`<li>${note}</li>`));
    this.#notes.hidden = notes.length === 0;
  }

  /** Shows `message` in place of the viewer, which goes; the next rows bring a new one. */
  #showMessage(message: unknown, kind: 'error' | 'notice'): void {
    this.#status.textContent = '';
    this.#dropViewer();
    this.#message.className = kind === 'error' ? 'd-notice d-notice--error' : 'd-notice';
    this.#message.textContent = message instanceof Error ? message.message : String(message);
    this.#body.replaceChildren(this.#message);
  }

  /** Takes away the viewer and its table, if one is shown. */
  #dropViewer(): void {
    if (!this.#shown) return;
    const { viewer, table } = this.#shown;
    this.#shown = undefined;
    void viewer.delete().then(() => table.delete());
    viewer.remove();
  }
}
