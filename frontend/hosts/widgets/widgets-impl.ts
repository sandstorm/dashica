// See WidgetsApi in widgets.ts.
import * as Arrow from 'apache-arrow';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { ActiveQuerySource, FilterOp, QueryApi } from '../query/query';
import type { FloatingBar, MenuAnchor, UiApi } from '../ui/ui';
import type { QueryResult, RenderedWidget, Selection, WidgetContext, WidgetMenuContext, WidgetRecord, WidgetRenderer, WidgetsApi, WidgetStatus } from './widgets';
import './widgets.css';

/**
 * The workbench's `WidgetsApi`, and how the page renders its widgets (`render`). It shows the floating bar
 * `widget/selection` for the selection, and listens for Escape and clicks while there is one. The active widget of
 * each tab is kept under the tab's query state; `tabs` tells which tab is active. Each rendered widget with data is a
 * `WidgetInstance`: its renderer's context and, as `active`, the widget itself.
 */
export class WidgetsHost implements WidgetsApi {
  // `any`: each renderer takes the widgets of its own type, the one it is registered for
  readonly #renderers = new Map<WidgetType, WidgetRenderer<any>>();
  readonly #selectionBar: FloatingBar<Selection>;
  #selection: { selection: Selection; owner: WidgetInstance | undefined; listening: Disposable } | undefined;
  /** Each tab's active widget, by the tab's query state. */
  readonly #active = new Map<QueryApi, WidgetInstance>();
  /** The active widget as told last through `onDidChangeActive`. */
  #told: WidgetInstance | undefined;
  readonly #onDidChangeActive = new EventEmitter<void>();
  readonly onDidChangeActive = this.#onDidChangeActive.event;
  readonly #onDidChangeTabs: Disposable;

  constructor(
    private readonly ui: Pick<UiApi, 'showContextMenu' | 'showChoices' | 'registerFloatingBar'>,
    private readonly tabs: ActiveQuerySource,
  ) {
    this.#selectionBar = ui.registerFloatingBar<Selection>({
      id: 'widget/selection',
      title: 'Selection',
      anchor: ({ anchor }) => (anchor.isConnected ? anchor.getBoundingClientRect() : null),
    });
    this.#onDidChangeTabs = tabs.onDidChangeTabs(() => this.#tell());
  }

  get active(): RenderedWidget | undefined {
    return this.#active.get(this.tabs.activeQuery);
  }

  /** Makes `widget` its tab's active widget, outlining its element in place of the one before. */
  activate(widget: WidgetInstance): void {
    const before = this.#active.get(widget.state);
    if (before === widget) return;
    before?.el.classList.remove(ACTIVE);
    widget.el.classList.add(ACTIVE);
    this.#active.set(widget.state, widget);
    this.#tell();
  }

  /** `widget` is removed: its tab has no active widget if it was that one. */
  deactivate(widget: WidgetInstance): void {
    if (this.#active.get(widget.state) !== widget) return;
    widget.el.classList.remove(ACTIVE);
    this.#active.delete(widget.state);
    this.#tell();
  }


  /** Fires `onDidChangeActive` when the active tab's active widget is another one than told last. */
  #tell(): void {
    const now = this.#active.get(this.tabs.activeQuery);
    if (now === this.#told) return;
    this.#told = now;
    this.#onDidChangeActive.fire();
  }

  dispose(): void {
    this.#onDidChangeTabs.dispose();
    this.#onDidChangeActive.dispose();
    this.#active.clear();
  }

  get selection(): Selection | undefined {
    return this.#selection?.selection;
  }

  select(selection: Selection): void {
    this.selectOf(undefined, selection);
  }

  /** Selects `selection` of `owner` (`undefined`: of no rendered widget), ending the one before. */
  selectOf(owner: WidgetInstance | undefined, selection: Selection): void {
    this.clearSelection();
    const doc = selection.anchor.ownerDocument;
    // the click that selected is past the document already; the next one, wherever it lands, ends the selection
    const onClick = () => this.clearSelection();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.clearSelection();
    };
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey);
    const listening = new Disposable(() => {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKey);
    });
    this.#selection = { selection, owner, listening };
    this.#selectionBar.show(selection);
  }

  clearSelection(): void {
    if (!this.#selection) return;
    this.#selection.listening.dispose();
    this.#selection = undefined;
    this.#selectionBar.hide();
  }

  registerWidget<T extends WidgetType>(type: T, renderer: WidgetRenderer<T>): Disposable {
    if (this.#renderers.has(type)) throw new Error(`There is a renderer for the widget type ${type} already`);
    this.#renderers.set(type, renderer);
    return new Disposable(() => this.#renderers.delete(type));
  }

  /** Renders `widget` into `el` with `state` until disposed; a type without renderer, or a renderer that throws, shows its error there. */
  render(el: HTMLElement, widget: WidgetNode, state: QueryApi): Disposable {
    if ('dataUrl' in widget && widget.dataUrl) el.dataset.dataUrl = widget.dataUrl;
    const renderer = this.#renderers.get(widget.type);
    if (!renderer) {
      showWidgetError(el, new Error('no renderer for this widget type'), widget);
      return new Disposable(() => el.replaceChildren());
    }
    try {
      const ctx = new WidgetInstance(widget, el, this, state, this.ui);
      const rendered = renderer(el, widget, ctx);
      const listening = 'dataUrl' in widget && widget.dataUrl ? this.#activateOn(el, ctx) : Disposable.from();
      return new Disposable(() => {
        if (this.#selection?.owner === ctx) this.clearSelection();
        listening.dispose();
        this.deactivate(ctx);
        rendered.dispose();
        ctx.dispose();
        el.replaceChildren();
      });
    } catch (error) {
      showWidgetError(el, error, widget);
      return new Disposable(() => el.replaceChildren());
    }
  }

  /**
   * A press or the focus anywhere in `el` makes `ctx` active, unless it lands in a widget with data inside it. The
   * press is heard on its way down (capture), since a chart stops the presses on its marks (selectOnClick).
   */
  #activateOn(el: HTMLElement, ctx: WidgetInstance): Disposable {
    const onEvent = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-data-url]') === el) this.activate(ctx);
    };
    el.addEventListener('pointerdown', onEvent, true);
    el.addEventListener('focusin', onEvent);
    return new Disposable(() => {
      el.removeEventListener('pointerdown', onEvent, true);
      el.removeEventListener('focusin', onEvent);
    });
  }
}

/** The class of the active widget's element in each tab: its outline. */
const ACTIVE = 'd-widget--active';

/**
 * One rendered widget: its renderer's context, what its menu `widget/context` is shown for, and, with data, the
 * `RenderedWidget` that `active` refers to.
 */
class WidgetInstance implements WidgetContext, WidgetMenuContext, RenderedWidget {
  lastResult: QueryResult | undefined;
  #status: WidgetStatus = { kind: 'idle' };
  readonly #onDidChangeStatus = new EventEmitter<void>();
  readonly onDidChangeStatus = this.#onDidChangeStatus.event;
  #records: readonly WidgetRecord[] = [];
  readonly #onDidChangeRecords = new EventEmitter<void>();
  readonly onDidChangeRecords = this.#onDidChangeRecords.event;
  /** Removed: a late `selectRecords` neither makes it active nor tells anything. */
  #removed = false;
  /** The calls of `query` so far: only the latest one sets the status. */
  #queries = 0;
  /** The status of the last query that answered or failed, put back when the latest one is aborted. */
  #settled: WidgetStatus = this.#status;

  constructor(
    readonly widget: WidgetNode,
    /** The element it is rendered into, outlined while it is active. */
    readonly el: HTMLElement,
    private readonly host: WidgetsHost,
    readonly state: QueryApi,
    private readonly ui: Pick<UiApi, 'showContextMenu' | 'showChoices'>,
  ) {}

  get status(): WidgetStatus {
    return this.#status;
  }

  get records(): readonly WidgetRecord[] {
    return this.#records;
  }

  url(path: string): string {
    if (!('dataUrl' in this.widget)) throw new Error(`the widget ${this.widget.type} has no data`);
    return `${this.widget.dataUrl}${path}?${this.state.requestParams()}`;
  }

  /** Queries `/query`; the status tells how the latest call goes, an aborted latest call puts back the last answer's. */
  async query(signal?: AbortSignal): Promise<QueryResult> {
    const turn = ++this.#queries;
    const started = performance.now();
    this.#setStatus({ kind: 'loading' });
    let result: QueryResult;
    try {
      result = await fetchQueryResult(this.url('/query'), signal);
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      if (turn === this.#queries) this.#setStatus(signal?.aborted ? this.#settled : { kind: 'error', message: error instanceof Error ? error.message : String(error), ms });
      throw error;
    }
    if (turn !== this.#queries) return result;
    const ms = Math.round(performance.now() - started);
    this.lastResult = result;
    this.#setStatus({ kind: 'done', rows: result.numRows, ms, diagnostics: result.dashicaDiagnostics ?? {} });
    return result;
  }

  #setStatus(status: WidgetStatus): void {
    this.#status = status;
    if (status.kind !== 'loading') this.#settled = status;
    this.#onDidChangeStatus.fire();
  }

  renderChild(el: HTMLElement, child: WidgetNode): Disposable {
    return this.host.render(el, child, this.state);
  }

  showMenu(menuId: string, anchor: MenuAnchor, context?: object): void {
    const shown = context ? { widget: this.widget, url: (path: string) => this.url(path), lastResult: this.lastResult, ...context } : this;
    this.ui.showContextMenu(menuId, { anchor, title: this.widget.type, context: shown, args: [shown] });
  }

  addFilter(fieldId: string, op: FilterOp, value: string): void {
    this.state.filters.add(fieldId, op, value);
  }

  select(selection: Omit<Selection, 'widgetId'>): void {
    const widgetId = 'dataUrl' in this.widget ? this.widget.dataUrl.split('/').pop()! : '';
    this.host.selectOf(this, { ...selection, widgetId });
  }

  choose(at: MenuAnchor, candidates: readonly Omit<Selection, 'widgetId'>[]): void {
    const entries = candidates.map((candidate) => ({ label: `${candidate.fieldId} = ${candidate.value}`, run: () => this.select(candidate) }));
    this.ui.showChoices(entries, { anchor: at, title: 'Select' });
  }

  clearSelection(): void {
    this.host.clearSelection();
  }

  /** With records it becomes its tab's active widget first, so the records' change is told to whoever follows it. */
  selectRecords(records: readonly WidgetRecord[]): void {
    if (this.#removed || (records.length === 0 && this.#records.length === 0)) return;
    this.#records = records;
    if (records.length > 0) this.host.activate(this);
    this.#onDidChangeRecords.fire();
  }

  /** It is removed: its events end. */
  dispose(): void {
    this.#removed = true;
    this.#onDidChangeStatus.dispose();
    this.#onDidChangeRecords.dispose();
  }
}

/** A widget's title (`props.title`), else its type (`timeBar`). */
export function widgetTitle(widget: WidgetNode): string {
  return 'title' in widget.props && widget.props.title ? widget.props.title : widget.type;
}

/** Shows `error` in `el` in place of the widget: its message and the widget's type. */
export function showWidgetError(el: HTMLElement, error: unknown, widget: Pick<WidgetNode, 'type'>): void {
  const message = error instanceof Error ? error.message : String(error);
  const shown = el.ownerDocument.createElement('div');
  shown.className = 'd-widget-error';
  shown.textContent = `${message} (${widget.type})`;
  el.replaceChildren(shown);
}

/**
 * The Arrow table at `url`, with what the server said about it in the headers (resolved time range, bucket size, …);
 * an empty table for a chart that did not run (204, its Diagnostics say why).
 */
async function fetchQueryResult(url: string, signal?: AbortSignal): Promise<QueryResult> {
  const response = await fetch(url, { signal });
  if (response.status !== 200 && response.status !== 204) throw new Error(await response.text());
  const result = (response.status === 204 ? new Arrow.Table() : await Arrow.tableFromIPC(response)) as QueryResult;
  result.dashicaResolvedTimeRange = JSON.parse(response.headers.get('X-Dashica-Resolved-Time-Range') || 'null');
  const bucketSize = response.headers.get('X-Dashica-Bucket-Size');
  if (bucketSize != null) result.dashicaBucketSize = parseInt(bucketSize);
  result.clickhouseSummary = JSON.parse(response.headers.get('X-Clickhouse-Summary') || 'null');
  result.dashicaAlertIf = JSON.parse(response.headers.get('X-Dashica-Alert-If') || 'null');
  result.dashicaDiagnostics = JSON.parse(response.headers.get('X-Dashica-Diagnostics') || '{}');
  return result;
}
