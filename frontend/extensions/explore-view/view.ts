// See exploreView in explore-view.ts.
import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { Memento } from '../../hosts/extension-host/extension-host';
import type { QueryApi } from '../../hosts/query/query';
import { initialView, type InitialView, type ViewerConfig } from './mapping';
import { describeRows, fetchRows, rowsRequest, type RowsAnswer } from './rows';

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

/** A chart that serves its rows to the view: its result, and maybe without grouping. */
export type ChartWithRows = Extract<WidgetNode, { rowsUrl?: string }> & { readonly rowsUrl: string };

export interface ExploreViewOptions {
  /** The chart whose rows the view shows. */
  readonly widget: ChartWithRows;
  readonly query: QueryApi;
  /** Keeps the viewer's config per chart and mode for this viewer (`stateKey`). */
  readonly state: Memento;
  readonly perspective: () => Promise<Perspective>;
  /** The view's "Close". */
  close(): void;
  /** A click on a group row's value (`perspective-click`). */
  select(selection: ViewSelection): void;
}

/**
 * Fills `el` with the Explore view of `options.widget` until disposed: a bar (title, "24 rows of the chart's result",
 * the chart's Diagnostics, "Remove grouping" when the answer allows it, "Reset", "Close"), the notes of the config
 * mapping, and `<perspective-viewer>` on the chart's result, or pressed "Remove grouping" its rows without grouping,
 * with the page's query state. It fetches them again on each `onDidRequestRefresh`, keeping the viewer's config, and
 * keeps the config the viewer changed per chart and mode; "Reset" goes back to the chart's.
 */
export function renderExploreView(el: HTMLElement, options: ExploreViewOptions): Disposable {
  const view = new ExploreView(el, options);
  return new Disposable(() => view.dispose());
}

/** The key of `widget`'s viewer config in the view's state, on its result or (`ungrouped`) its rows without grouping. */
export function stateKey(widget: { readonly dataUrl: string }, ungrouped = false): string {
  return ungrouped ? `view:${widget.dataUrl}:ungrouped` : `view:${widget.dataUrl}`;
}

/** What the viewer's config keeps across visits: without the table's name (new per visit), its theme and title. */
export function persistable(config: ViewerConfig): ViewerConfig {
  const { table: _table, theme: _theme, title: _title, ...kept } = config;
  return kept;
}

class ExploreView {
  readonly #status: HTMLElement = html`<span class="d-explore-view__status"></span>`;
  readonly #ignored: HTMLElement = html`<span class="d-badge" hidden></span>`;
  readonly #ungroup: HTMLButtonElement = html`<button class="d-button" type="button" aria-pressed="false" hidden data-testid="explore-view-ungroup">Remove grouping</button>`;
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
  /** "Remove grouping" is pressed: the rows without grouping are shown. */
  #ungrouped = false;
  #pointer = { x: 0, y: 0 };

  constructor(
    private readonly el: HTMLElement,
    private readonly options: ExploreViewOptions,
  ) {
    const title = 'title' in options.widget.props && options.widget.props.title ? options.widget.props.title : options.widget.type;
    const reset: HTMLButtonElement = html`<button class="d-button" type="button" data-testid="explore-view-reset">Reset</button>`;
    const close: HTMLButtonElement = html`<button class="d-button" type="button" data-testid="explore-view-close">Close</button>`;
    reset.onclick = () => void this.#reset();
    close.onclick = () => options.close();
    this.#ungroup.onclick = () => this.#toggleGrouping();
    el.replaceChildren(html`<div class="d-explore-view" data-testid="explore-view">
      <div class="d-explore-view__bar">
        <h2 class="d-explore-view__title">Explore: ${title}</h2>
        ${this.#status}${this.#ignored}
        <span class="d-explore-view__actions">${this.#ungroup}${reset}${close}</span>
      </div>
      ${this.#notes}${this.#body}
    </div>`);
    this.#body.append(this.#message);
    this.#listening = options.query.onDidRequestRefresh(() => void this.#load());
    void this.#load();
  }

  dispose(): void {
    this.#disposed = true;
    this.#loading?.abort();
    this.#listening.dispose();
    void this.#shown?.viewer.delete().then(() => this.#shown?.table.delete());
    this.el.replaceChildren();
  }

  /** Fetches the rows with the page's query state, then shows them. */
  async #load(): Promise<void> {
    this.#loading?.abort();
    const loading = new AbortController();
    this.#loading = loading;
    this.#status.textContent = 'loading…';
    const { widget, query } = this.options;
    const params = query.requestParams();
    let answer: RowsAnswer;
    try {
      answer = await fetchRows(rowsRequest(widget.rowsUrl, params, this.#ungrouped), loading.signal);
    } catch (error) {
      if (!loading.signal.aborted) this.#showMessage(error, 'error');
      return;
    }
    if (loading.signal.aborted) return;
    this.#ungroup.hidden = !answer.groupingRemovable;
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
    await this.#restore(this.options.state.get<ViewerConfig>(stateKey(this.options.widget, this.#ungrouped)));
  }

  /** "Remove grouping" pressed or released: a new viewer on the other rows, with the config kept for them or the start. */
  #toggleGrouping(): void {
    this.#ungrouped = !this.#ungrouped;
    this.#ungroup.setAttribute('aria-pressed', String(this.#ungrouped));
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
        await this.#shown!.viewer.restore(saved);
        this.#showNotes(notes);
        return;
      } catch (error) {
        notes.push(`the kept view does not fit these rows (${error instanceof Error ? error.message : String(error)}); shown as the chart`);
      }
    }
    await this.#shown!.viewer.restore(initial.config);
    this.#showNotes(notes);
  }

  /** "Reset": the chart's config, the kept one forgotten. */
  async #reset(): Promise<void> {
    if (!this.#shown) return;
    this.#touched = false;
    await this.options.state.update(stateKey(this.options.widget, this.#ungrouped), undefined);
    await this.#shown.viewer.reset(true);
    await this.#restore(undefined);
  }

  #initial(): InitialView {
    return initialView(this.options.widget, { kind: this.#ungrouped ? 'ungrouped' : 'result', columns: Object.keys(this.#shown?.schema ?? {}) });
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
      void this.options.state.update(stateKey(this.options.widget, this.#ungrouped), persistable(getConfig()));
    });
    viewer.addEventListener('perspective-click', (event: Event) => {
      const selection = this.#clicked((event as CustomEvent<{ config?: ViewerConfig }>).detail);
      if (selection) this.options.select(selection);
    });
  }

  /**
   * The value a click on a group row selects: the deepest of its group filters (`[column, '==', value]`) on a column
   * of the rows that is no date or time; `undefined` for any other click, and for every click on the rows without
   * grouping: their columns are raw, and a page filter on a column the chart also computes as a dimension filters on
   * the dimension's definition, which the raw value does not match.
   */
  #clicked(detail: { config?: ViewerConfig } | undefined): ViewSelection | undefined {
    if (this.#ungrouped) return undefined;
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
