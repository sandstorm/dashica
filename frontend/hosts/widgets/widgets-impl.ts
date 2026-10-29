// See WidgetsApi in widgets.ts.
import * as Arrow from 'apache-arrow';
import { Disposable } from '../../core/disposable/disposable';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { QueryApi } from '../query/query';
import type { UiApi } from '../ui/ui';
import type { QueryResult, WidgetContext, WidgetMenuContext, WidgetRenderer, WidgetsApi } from './widgets';
import './widgets.css';

/** The workbench's `WidgetsApi`, and how the page renders its widgets (`render`). */
export class WidgetsHost implements WidgetsApi {
  readonly #renderers = new Map<string, WidgetRenderer<WidgetType>>();

  constructor(
    private readonly query: QueryApi,
    private readonly ui: Pick<UiApi, 'showContextMenu'>,
  ) {}

  registerWidget<T extends WidgetType>(type: T, renderer: WidgetRenderer<T>): Disposable {
    if (this.#renderers.has(type)) throw new Error(`There is a renderer for the widget type ${type} already`);
    this.#renderers.set(type, renderer as unknown as WidgetRenderer<WidgetType>);
    return new Disposable(() => this.#renderers.delete(type));
  }

  /** Renders `widget` into `el` until disposed; a type without renderer, or a renderer that throws, shows its error there. */
  render(el: HTMLElement, widget: WidgetNode): Disposable {
    const renderer = this.#renderers.get(widget.type);
    let rendered: { dispose(): unknown } | undefined;
    try {
      if (!renderer) throw new Error('no renderer for this widget type');
      rendered = renderer.render(el, widget as never, this.#context(widget));
    } catch (error) {
      showWidgetError(el, error, widget);
    }
    return new Disposable(() => {
      rendered?.dispose();
      el.replaceChildren();
    });
  }

  #context(widget: WidgetNode): WidgetContext {
    const { time, filters, params, viewOptions, onDidRequestRefresh } = this.query;
    const url = (path: string) => `${widget.dataUrl ?? ''}${path}?${this.query.requestParams()}`;
    let lastResult: QueryResult | undefined;
    return {
      time,
      filters,
      params,
      viewOptions,
      onDidRequestRefresh,
      url,
      async query(signal) {
        if (!widget.dataUrl) throw new Error(`the widget ${widget.type} has no data`);
        lastResult = await fetchQueryResult(url('/query'), signal);
        return lastResult;
      },
      renderChild: (el, child) => this.render(el, child),
      showMenu: (anchor) => {
        const context: WidgetMenuContext = {
          widget,
          url,
          get lastResult() {
            return lastResult;
          },
        };
        this.ui.showContextMenu('widget/context', { anchor, title: widgetTitle(widget), context, args: [context] });
      },
    };
  }
}

/** Shows `error` in `el` in place of the widget: its message and the widget's type. */
export function showWidgetError(el: HTMLElement, error: unknown, widget: Pick<WidgetNode, 'type'>): void {
  const message = error instanceof Error ? error.message : String(error);
  const shown = el.ownerDocument.createElement('div');
  shown.className = 'dashica-widget-error';
  shown.textContent = `${message} (${widget.type})`;
  el.replaceChildren(shown);
}

/** The widget's title for its menu's accessible name, else its type. */
function widgetTitle(widget: WidgetNode): string {
  const title = (widget.props as { title?: unknown }).title;
  return typeof title === 'string' && title ? title : widget.type;
}

/** The Arrow table at `url`, with what the server said about it in the headers (resolved time range, bucket size, …). */
async function fetchQueryResult(url: string, signal?: AbortSignal): Promise<QueryResult> {
  const response = await fetch(url, { signal });
  if (response.status !== 200) throw new Error(await response.text());
  const result = (await Arrow.tableFromIPC(response)) as QueryResult;
  result.dashicaResolvedTimeRange = JSON.parse(response.headers.get('X-Dashica-Resolved-Time-Range') || 'null');
  const bucketSize = response.headers.get('X-Dashica-Bucket-Size');
  if (bucketSize != null) result.dashicaBucketSize = parseInt(bucketSize);
  result.clickhouseSummary = JSON.parse(response.headers.get('X-Clickhouse-Summary') || 'null');
  result.dashicaAlertIf = JSON.parse(response.headers.get('X-Dashica-Alert-If') || 'null');
  return result;
}
