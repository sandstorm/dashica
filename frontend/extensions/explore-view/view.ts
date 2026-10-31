// See exploreView in explore-view.ts.
import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { ChartSql, WidgetNode } from '../../generated/zz_generated.dashica';
import type { Memento } from '../../hosts/extension-host/extension-host';
import type { PageContext } from '../../hosts/page/page';
import type { QueryApi } from '../../hosts/query/query';
import type { MenuAnchor } from '../../hosts/ui/ui';
import type { FilterCandidate } from '../../hosts/widgets/widgets';
import { initialView, type InitialView, type ViewerConfig } from './mapping';
import {
  connectionRowsRequest,
  describeRows,
  editedQueryKeys,
  editedQueryOf,
  fetchRows,
  fetchSql,
  rowsRequest,
  sqlRequest,
  type EditedQuery,
  type RowsAnswer,
} from './rows';

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


/** A chart that serves its rows to the view: its result, and the rows of its SQL as the viewer edited it. */
export type ChartWithRows = Extract<WidgetNode, { rowsUrl?: string }> & { readonly rowsUrl: string };

export interface ExploreViewOptions {
  /**
   * The chart whose rows the view shows; `undefined`: a blank Explore, the rows of the SQL the viewer writes on the
   * connection the tab's hash names (`connection`, one of `connections`).
   */
  readonly widget: ChartWithRows | undefined;
  /** The ClickHouse connections of dashica_config a blank Explore picks from (`workbench.json`'s `connections`). */
  readonly connections: readonly string[];
  readonly query: QueryApi;
  /** Keeps the viewer's config per chart and mode for this viewer (`stateKey`). */
  readonly state: Memento;
  readonly perspective: () => Promise<Perspective>;
  /**
   * The tab's hash (`#explore=3`, `#explore=3&exploreSql=…&param_…` while the SQL is edited; a blank Explore's
   * `#explore=&connection=default`), as it is now.
   */
  hash(): string;
  /** Fires when the tab's hash changed (Run, Reset, back and forward). */
  readonly onDidChangeHash: PageContext['onDidChangeHash'];
  /** Goes to `hash` in the tab, a new entry of its history (`#explore=3&exploreSql=…`). */
  navigate(hash: string): void;
  /** The view's "Close". */
  close(): void;
  /** A click on a group row's value (`perspective-click`): offers to filter by it, at the click. */
  offerFilters(at: MenuAnchor, candidates: readonly FilterCandidate[]): void;
}

/**
 * Fills `el` with the Explore view of `options.widget` until disposed: a bar (title, "24 rows of the chart's result",
 * the chart's Diagnostics, "SQL" closing and opening the editor, "Reset", "Close"), the SQL editor (open from the
 * start) with the values of its parameters beside it, the notes of the config mapping, and `<perspective-viewer>`.
 * Following the chart (no `exploreSql` in the tab's hash) it shows the chart's result with the page's query state and
 * the editor the chart's SQL for that state, its placeholders (`{__from:DateTime64}`) kept and their values listed,
 * both fetched again on each `onDidRequestRefresh`. Run puts the editor's text and the listed values into the hash
 * (`exploreSql`, `param_<name>`): the view then shows that query's rows, which the page's time range and filters do
 * not change, until "Reset to the chart's query". It keeps the config the viewer changed per chart and mode; "Reset"
 * goes back to the chart's. A blank Explore (no `widget`) has a connection picker in its bar in place of the chart's
 * state: its editor starts empty, Run shows the rows of its text on the picked connection (`/rows?connection=…`), and
 * the pick is the hash's `connection`.
 */
export function renderExploreView(el: HTMLElement, options: ExploreViewOptions): Disposable {
  const view = new ExploreView(el, options);
  return new Disposable(() => view.dispose());
}

/** What the view calls `widget`: its title, else its type; a blank Explore (`undefined`) is "Explore". */
export function chartTitle(widget: WidgetNode | undefined): string {
  if (widget === undefined) return 'Explore';
  return 'title' in widget.props && widget.props.title ? widget.props.title : widget.type;
}

/**
 * The key of `widget`'s viewer config in the view's state, on its result or (`edited`) the rows of an edited query;
 * one key for every blank Explore (`undefined`).
 */
export function stateKey(widget: { readonly dataUrl: string } | undefined, edited = false): string {
  if (widget === undefined) return 'view:blank';
  return edited ? `view:${widget.dataUrl}:edited` : `view:${widget.dataUrl}`;
}

/** The connection a blank Explore's hash `hash` picks (`connection`), else the first of `connections`. */
export function pickedConnection(hash: string, connections: readonly string[]): string {
  const named = new URLSearchParams(hash.replace(/^#/, '')).get('connection');
  return named !== null && connections.includes(named) ? named : (connections[0] ?? 'default');
}

/** `hash` picking the connection `connection` (`connection`), its other keys kept. */
export function withConnection(hash: string, connection: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  params.set('connection', connection);
  return `#${params}`;
}

/** The query the tab's hash `hash` holds (`#explore=3&exploreSql=…&param_…`); `undefined` while the view follows the chart. */
export function editedQuery(hash: string): EditedQuery | undefined {
  return editedQueryOf(new URLSearchParams(hash.replace(/^#/, '')));
}

/** `hash` with the edited query `edited` (`editedQueryKeys`), or without one for `undefined`; its other keys kept. */
export function withEditedQuery(hash: string, edited: EditedQuery | undefined): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  for (const key of [...params.keys()]) if (key === 'exploreSql' || key.startsWith('param_')) params.delete(key);
  for (const [key, value] of edited ? editedQueryKeys(edited) : []) params.append(key, value);
  return `#${params}`;
}

/** `a` and `b` are the same edited query (or both none): the same SQL and parameters. */
function sameQuery(a: EditedQuery | undefined, b: EditedQuery | undefined): boolean {
  return withEditedQuery('', a) === withEditedQuery('', b);
}

/** What the viewer's config keeps across visits: without the table's name (new per visit), its theme and title. */
export function persistable(config: ViewerConfig): ViewerConfig {
  const { table: _table, theme: _theme, title: _title, ...kept } = config;
  return kept;
}

class ExploreView {
  readonly #status: HTMLElement = html`<span class="d-explore-view__status"></span>`;
  readonly #ignored: HTMLElement = html`<span class="d-badge" hidden></span>`;
  readonly #sqlButton: HTMLButtonElement = html`<button class="d-button" type="button" aria-pressed="true" data-testid="explore-view-sql">SQL</button>`;
  readonly #sqlText: HTMLTextAreaElement = html`<textarea
    class="d-field d-field--full d-field--mono d-explore-view__sql-text"
    rows="8"
    spellcheck="false"
    aria-label="SQL"
    data-testid="explore-view-sql-text"></textarea>`;
  readonly #sqlNote: HTMLElement = html`<span class="d-explore-view__status" data-testid="explore-view-sql-note"></span>`;
  readonly #parameters: HTMLElement = html`<dl class="d-explore-view__parameters" aria-label="Parameters" data-testid="explore-view-parameters"></dl>`;
  readonly #sqlError: HTMLElement = html`<div class="d-notice d-notice--error" hidden></div>`;
  readonly #sqlPanel: HTMLElement = html`<div class="d-explore-view__sql" data-testid="explore-view-sql-panel"></div>`;
  readonly #editedNote: HTMLElement = html`<div class="d-notice d-explore-view__edited" hidden data-testid="explore-view-edited"></div>`;
  readonly #notes: HTMLElement = html`<ul class="d-explore-view__notes" hidden></ul>`;
  readonly #body: HTMLElement = html`<div class="d-explore-view__body"></div>`;
  readonly #message: HTMLElement = html`<div class="d-explore-view__message"><span class="d-spinner"></span></div>`;
  readonly #connection: HTMLSelectElement = html`<select class="d-field" aria-label="Connection" data-testid="explore-view-connection"></select>`;
  readonly #listening: Disposable;
  #loading: AbortController | undefined;
  #disposed = false;
  #shown: { viewer: PerspectiveViewer; table: PerspectiveTable; schema: Record<string, string> } | undefined;
  /** The rows being shown; the next rows wait for it, so one viewer and table come of loads that overlap. */
  #showing: Promise<void> = Promise.resolve();
  /** The viewer was used (a press or a key in it): its config changes are the viewer's own, kept. */
  #touched = false;
  /** The query the view shows the rows of (the tab's hash's `exploreSql`); `undefined`: the chart's result. */
  #edited: EditedQuery | undefined;
  /** The chart's SQL and parameters as last fetched, the SQL written into the editor; `undefined` before. */
  #chartSql: ChartSql | undefined;
  #loadingSql: AbortController | undefined;
  /** The editor is open, as "SQL" toggles it; always while edited. */
  #sqlOpen = true;
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
    const backToChart = () => options.navigate(withEditedQuery(options.hash(), undefined));
    const resetSql: HTMLButtonElement = html`<button class="d-button" type="button" data-testid="explore-view-sql-reset">Reset to the chart’s query</button>`;
    resetSql.onclick = backToChart;
    this.#editedNote.append('Edited query: the page’s time range and filters do not apply. ', resetSql);
    this.#sqlPanel.append(
      html`<div class="d-explore-view__sql-edit">${this.#sqlText}${this.#parameters}</div>`,
      html`<div class="d-explore-view__sql-bar">${run}${this.#sqlNote}</div>`,
      this.#sqlError,
    );
    this.#connection.replaceChildren(...options.connections.map((name) => html`<option value=${name}>${name}</option>`));
    this.#connection.value = pickedConnection(options.hash(), options.connections);
    this.#connection.onchange = () => options.navigate(withConnection(options.hash(), this.#connection.value));
    el.replaceChildren(html`<div class="d-explore-view" data-testid="explore-view">
      <div class="d-explore-view__bar">
        <h2 class="d-explore-view__title">${options.widget ? `Explore: ${title}` : title}</h2>
        ${options.widget ? '' : this.#connection}${this.#status}${this.#ignored}
        <span class="d-explore-view__actions">${this.#sqlButton}${reset}${close}</span>
      </div>
      ${this.#sqlPanel}${this.#editedNote}${this.#notes}${this.#body}
    </div>`);
    this.#body.append(this.#message);
    this.#edited = editedQuery(options.hash());
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
   * the chart with the editor open, its SQL too. A blank Explore fetches the rows of its query on the picked
   * connection; before a Run it says how to start.
   */
  async #load(): Promise<void> {
    this.#loading?.abort();
    const loading = new AbortController();
    this.#loading = loading;
    this.#status.textContent = 'loading…';
    const { widget, query } = this.options;
    if (widget === undefined && this.#edited === undefined) {
      this.#showMessage('Write a query; Run shows its rows.', 'notice');
      return;
    }
    if (widget !== undefined && this.#edited === undefined && !this.#sqlPanel.hidden) void this.#loadSql();
    const url = widget === undefined ? connectionRowsRequest(this.#connection.value, this.#edited!) : rowsRequest(widget.rowsUrl, query.requestParams(), this.#edited);
    let answer: RowsAnswer;
    try {
      answer = await fetchRows(url, loading.signal);
    } catch (error) {
      if (!loading.signal.aborted) this.#showMessage(error, 'error');
      return;
    }
    if (loading.signal.aborted) return;
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
   * Fetches the chart's SQL with the page's query state into the editor, its parameters beside it; a draft (a text
   * that differs from the SQL fetched before) stays. Its error shows below the editor.
   */
  async #loadSql(): Promise<void> {
    if (!this.options.widget) return;
    this.#loadingSql?.abort();
    const loading = new AbortController();
    this.#loadingSql = loading;
    let chartSql: ChartSql;
    try {
      chartSql = await fetchSql(sqlRequest(this.options.widget.dataUrl, this.options.query.requestParams()), loading.signal);
    } catch (error) {
      if (loading.signal.aborted) return;
      this.#sqlError.hidden = false;
      this.#sqlError.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    if (loading.signal.aborted || this.#edited !== undefined) return;
    this.#sqlError.hidden = true;
    const draft = this.#sqlText.value !== (this.#chartSql?.sql ?? '') && this.#sqlText.value !== '';
    this.#chartSql = chartSql;
    if (!draft) this.#sqlText.value = chartSql.sql;
    this.#showParameters();
    this.#showSqlNote();
  }

  #setSqlOpen(open: boolean): void {
    this.#sqlOpen = open;
    this.#showSqlPanel();
  }

  /** Shows the editor while it is open; on showing, the chart's SQL. */
  #showSqlPanel(): void {
    const wasHidden = this.#sqlPanel.hidden;
    this.#sqlButton.setAttribute('aria-pressed', String(this.#sqlOpen));
    this.#sqlPanel.hidden = !this.#sqlOpen;
    if (wasHidden && !this.#sqlPanel.hidden && this.#edited === undefined) void this.#loadSql();
  }

  /**
   * Run: the editor's text into the tab's hash, with the parameters listed (the edited query's, else the chart's as
   * fetched last); the chart's SQL as fetched last follows the chart again.
   */
  #run(): void {
    const text = this.#sqlText.value;
    const following = this.#edited === undefined && text === this.#chartSql?.sql;
    this.options.navigate(withEditedQuery(this.options.hash(), following ? undefined : { sql: text, parameters: this.#shownParameters() }));
  }

  /** The values of the parameters the editor's SQL is run with: the edited query's, else the chart's. */
  #shownParameters(): Readonly<Record<string, string>> {
    return this.#edited?.parameters ?? this.#chartSql?.parameters ?? {};
  }

  /** Lists `#shownParameters` beside the editor by name, `{name}` and its value; hidden without any. */
  #showParameters(): void {
    const entries = Object.entries(this.#shownParameters()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    this.#parameters.replaceChildren(...entries.map(([name, value]) => html.fragment`<dt><code>{${name}}</code></dt><dd>${value}</dd>`));
    this.#parameters.hidden = entries.length === 0;
  }

  /**
   * Shows what the hash says: the editor and the note while edited (a blank Explore has no chart to go back to, so no
   * note), the editor's text the hash's.
   */
  #showEdited(): void {
    const edited = this.#edited !== undefined;
    this.#editedNote.hidden = !edited || !this.options.widget;
    if (edited) {
      this.#sqlText.value = this.#edited!.sql;
      this.#setSqlOpen(true);
    } else if (this.#chartSql !== undefined) this.#sqlText.value = this.#chartSql.sql;
    this.#showParameters();
    this.#showSqlNote();
  }

  /** "not run" while the editor's text is not the SQL whose rows are shown. */
  #showSqlNote(): void {
    const shown = this.#edited?.sql ?? this.#chartSql?.sql;
    this.#sqlNote.textContent = shown !== undefined && this.#sqlText.value !== shown ? 'not run' : '';
  }

  /**
   * The tab's hash changed (or a Run went to the same one): the rows of the SQL it names, in a new viewer when it went
   * from or to the chart's result.
   */
  #hashChanged(): void {
    this.#connection.value = pickedConnection(this.options.hash(), this.options.connections);
    const edited = editedQuery(this.options.hash());
    const otherRows = (edited === undefined) !== (this.#edited === undefined);
    if (!sameQuery(edited, this.#edited)) {
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
      const candidate = this.#clicked((event as CustomEvent<{ config?: ViewerConfig }>).detail);
      if (candidate) this.options.offerFilters(this.#pointer, [candidate]);
    });
  }

  /**
   * The value a click on a group row offers: the deepest of its group filters (`[column, '==', value]`) on a column
   * of the rows that is no date or time; `undefined` for any other click, and for every click on the rows of an edited
   * query: their columns are whatever its text selects, and a page filter does not change the edited query.
   */
  #clicked(detail: { config?: ViewerConfig } | undefined): FilterCandidate | undefined {
    if (this.#edited !== undefined) return undefined;
    const schema = this.#shown?.schema ?? {};
    const filters = (detail?.config?.filter ?? []).filter(
      ([column, op, value]) => op === '==' && value != null && column in schema && schema[column] !== 'date' && schema[column] !== 'datetime',
    );
    const last = filters.at(-1);
    if (!last) return undefined;
    return { fieldId: last[0], value: String(last[2]) };
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
