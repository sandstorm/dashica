// See WidgetsApi in widgets.ts.
import * as Arrow from 'apache-arrow';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { ActiveQuerySource, QueryApi } from '../query/query';
import type { MenuAnchor, UiApi } from '../ui/ui';
import type { QueryResult, RenderedWidget, WidgetContext, WidgetMenuContext, WidgetRenderer, WidgetsApi, WidgetStatus } from './widgets';
import './widgets.css';

/**
 * The workbench's `WidgetsApi`, and how the page renders its widgets (`render`). The active widget of each tab is kept
 * under the tab's query state; `tabs` tells which tab is active. Each rendered widget with data is a `WidgetInstance`:
 * its renderer's context and, as `active`, the widget itself.
 */
export class WidgetsHost implements WidgetsApi {
  // `any`: each renderer takes the widgets of its own type, the one it is registered for
  readonly #renderers = new Map<WidgetType, WidgetRenderer<any>>();
  /** Each tab's active widget, by the tab's query state. */
  readonly #active = new Map<QueryApi, WidgetInstance>();
  /** The active widget as told last through `onDidChangeActive`. */
  #told: WidgetInstance | undefined;
  readonly #onDidChangeActive = new EventEmitter<void>();
  readonly onDidChangeActive = this.#onDidChangeActive.event;
  readonly #onDidChangeTabs: Disposable;

  constructor(
    private readonly ui: Pick<UiApi, 'showContextMenu'>,
    private readonly tabs: ActiveQuerySource,
  ) {
    this.#onDidChangeTabs = tabs.onDidChangeTabs(() => this.#tell());
  }

  get active(): RenderedWidget | undefined {
    return this.#active.get(this.tabs.activeQuery);
  }

  /** Makes `widget` its tab's active widget, outlining its element in place of the one before. */
  activate(widget: WidgetInstance): void {
    const before = this.#active.get(widget.query);
    if (before === widget) return;
    before?.el.classList.remove(ACTIVE);
    widget.el.classList.add(ACTIVE);
    this.#active.set(widget.query, widget);
    this.#tell();
  }

  /** `widget` is removed: its tab has no active widget if it was that one. */
  deactivate(widget: WidgetInstance): void {
    if (this.#active.get(widget.query) !== widget) return;
    widget.el.classList.remove(ACTIVE);
    this.#active.delete(widget.query);
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

  registerWidget<T extends WidgetType>(type: T, renderer: WidgetRenderer<T>): Disposable {
    if (this.#renderers.has(type)) throw new Error(`There is a renderer for the widget type ${type} already`);
    this.#renderers.set(type, renderer);
    return new Disposable(() => this.#renderers.delete(type));
  }

  /** Renders `widget` into `el` with `query` until disposed; a type without renderer, or a renderer that throws, shows its error there. */
  render(el: HTMLElement, widget: WidgetNode, query: QueryApi): Disposable {
    if ('dataUrl' in widget && widget.dataUrl) el.dataset.dataUrl = widget.dataUrl;
    const renderer = this.#renderers.get(widget.type);
    if (!renderer) {
      showWidgetError(el, new Error('no renderer for this widget type'), widget);
      return new Disposable(() => el.replaceChildren());
    }
    try {
      const ctx = new WidgetInstance(widget, el, this, query, this.ui);
      const rendered = renderer(el, widget, ctx);
      const listening = 'dataUrl' in widget && widget.dataUrl ? this.#activateOn(el, ctx) : Disposable.from();
      return new Disposable(() => {
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
   * press is heard on its way down (capture), since a chart stops the presses on its marks (filterOnClick).
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
  /** The calls of `runQuery` so far: only the latest one sets the status. */
  #queries = 0;
  /** The status of the last query that answered or failed, put back when the latest one is aborted. */
  #settled: WidgetStatus = this.#status;

  constructor(
    readonly widget: WidgetNode,
    /** The element it is rendered into, outlined while it is active. */
    readonly el: HTMLElement,
    private readonly host: WidgetsHost,
    readonly query: QueryApi,
    private readonly ui: Pick<UiApi, 'showContextMenu'>,
  ) {}

  get status(): WidgetStatus {
    return this.#status;
  }

  url(path: string): string {
    if (!('dataUrl' in this.widget)) throw new Error(`the widget ${this.widget.type} has no data`);
    return `${this.widget.dataUrl}${path}?${this.query.requestParams()}`;
  }

  /** Queries `/query`; the status tells how the latest call goes, an aborted latest call puts back the last answer's. */
  async runQuery(signal?: AbortSignal): Promise<QueryResult> {
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
    return this.host.render(el, child, this.query);
  }

  showMenu(menuId: string, anchor: MenuAnchor, context?: object): void {
    const shown = context ? { widget: this.widget, url: (path: string) => this.url(path), lastResult: this.lastResult, ...context } : this;
    this.ui.showContextMenu(menuId, { anchor, title: this.widget.type, context: shown, args: [shown] });
  }

  /** It is removed: its event ends. */
  dispose(): void {
    this.#onDidChangeStatus.dispose();
  }
}

/** Shows `error` in `el` in place of the widget: its message and the widget's type. */
function showWidgetError(el: HTMLElement, error: unknown, widget: Pick<WidgetNode, 'type'>): void {
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
  result.dashicaColumnTypes = JSON.parse(response.headers.get('X-Dashica-Column-Types') || '{}');
  return result;
}
