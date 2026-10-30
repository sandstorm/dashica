// See WidgetsApi in widgets.ts.
import * as Arrow from 'apache-arrow';
import { Disposable } from '../../core/disposable/disposable';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { FilterOp, QueryApi } from '../query/query';
import type { FloatingBar, MenuAnchor, UiApi } from '../ui/ui';
import type { QueryResult, Selection, WidgetContext, WidgetMenuContext, WidgetRenderer, WidgetsApi } from './widgets';
import './widgets.css';

/**
 * The workbench's `WidgetsApi`, and how the page renders its widgets (`render`). It shows the floating bar
 * `widget/selection` for the selection, and listens for Escape and clicks while there is one.
 */
export class WidgetsHost implements WidgetsApi {
  // `any`: each renderer takes the widgets of its own type, the one it is registered for
  readonly #renderers = new Map<WidgetType, WidgetRenderer<any>>();
  readonly #selectionBar: FloatingBar<Selection>;
  #selection: { selection: Selection; owner: RenderedWidget; listening: Disposable } | undefined;

  constructor(
    private readonly query: QueryApi,
    private readonly ui: Pick<UiApi, 'showContextMenu' | 'showChoices' | 'registerFloatingBar'>,
  ) {
    this.#selectionBar = ui.registerFloatingBar<Selection>({
      id: 'widget/selection',
      title: 'Selection',
      anchor: ({ anchor }) => (anchor.isConnected ? anchor.getBoundingClientRect() : null),
    });
  }

  get selection(): Selection | undefined {
    return this.#selection?.selection;
  }

  /** Selects `selection` of `owner`, ending the one before. */
  select(owner: RenderedWidget, selection: Selection): void {
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

  /** Renders `widget` into `el` until disposed; a type without renderer, or a renderer that throws, shows its error there. */
  render(el: HTMLElement, widget: WidgetNode): Disposable {
    if ('dataUrl' in widget && widget.dataUrl) el.dataset.dataUrl = widget.dataUrl;
    const renderer = this.#renderers.get(widget.type);
    if (!renderer) {
      showWidgetError(el, new Error('no renderer for this widget type'), widget);
      return new Disposable(() => el.replaceChildren());
    }
    try {
      const ctx = new RenderedWidget(widget, this, this.query, this.ui);
      const rendered = renderer(el, widget, ctx);
      return new Disposable(() => {
        if (this.#selection?.owner === ctx) this.clearSelection();
        rendered.dispose();
        el.replaceChildren();
      });
    } catch (error) {
      showWidgetError(el, error, widget);
      return new Disposable(() => el.replaceChildren());
    }
  }
}

/** The context of one rendered widget; also what its menu `widget/context` is shown for. */
class RenderedWidget implements WidgetContext, WidgetMenuContext {
  lastResult: QueryResult | undefined;

  constructor(
    readonly widget: WidgetNode,
    private readonly host: WidgetsHost,
    readonly state: QueryApi,
    private readonly ui: Pick<UiApi, 'showContextMenu' | 'showChoices'>,
  ) {}

  url(path: string): string {
    if (!('dataUrl' in this.widget)) throw new Error(`the widget ${this.widget.type} has no data`);
    return `${this.widget.dataUrl}${path}?${this.state.requestParams()}`;
  }

  async query(signal?: AbortSignal): Promise<QueryResult> {
    this.lastResult = await fetchQueryResult(this.url('/query'), signal);
    return this.lastResult;
  }

  renderChild(el: HTMLElement, child: WidgetNode): Disposable {
    return this.host.render(el, child);
  }

  showMenu(anchor: HTMLElement): void {
    this.ui.showContextMenu('widget/context', { anchor, title: this.widget.type, context: this, args: [this] });
  }

  addFilter(fieldId: string, op: FilterOp, value: string): void {
    this.state.filters.add(fieldId, op, value);
  }

  select(selection: Omit<Selection, 'widgetId'>): void {
    const widgetId = 'dataUrl' in this.widget ? this.widget.dataUrl.split('/').pop()! : '';
    this.host.select(this, { ...selection, widgetId });
  }

  choose(at: MenuAnchor, candidates: readonly Omit<Selection, 'widgetId'>[]): void {
    const entries = candidates.map((candidate) => ({ label: `${candidate.fieldId} = ${candidate.value}`, run: () => this.select(candidate) }));
    this.ui.showChoices(entries, { anchor: at, title: 'Select' });
  }

  clearSelection(): void {
    this.host.clearSelection();
  }
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
