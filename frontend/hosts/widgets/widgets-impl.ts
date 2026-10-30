// See WidgetsApi in widgets.ts.
import * as Arrow from 'apache-arrow';
import { Disposable } from '../../core/disposable/disposable';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { Commands } from '../commands/commands';
import type { QueryApi } from '../query/query';
import type { UiApi } from '../ui/ui';
import type { QueryResult, WidgetContext, WidgetMenuContext, WidgetRenderer, WidgetsApi } from './widgets';
import './widgets.css';

/** The workbench's `WidgetsApi`, and how the page renders its widgets (`render`). */
export class WidgetsHost implements WidgetsApi {
  // `any`: each renderer takes the widgets of its own type, the one it is registered for
  readonly #renderers = new Map<WidgetType, WidgetRenderer<any>>();
  readonly #registrations: Disposable[] = [];

  constructor(
    private readonly query: QueryApi,
    private readonly ui: Pick<UiApi, 'showContextMenu' | 'registerMenuItem'>,
    commands: Pick<Commands, 'registerCommand'>,
  ) {
    this.#registrations.push(
      commands.registerCommand('widget.toggleLogScale', (widget: WidgetMenuContext) => widget.setLogScale(!widget.logScale)),
    );
    this.#registrations.push(
      ui.registerMenuItem<WidgetMenuContext>('widget/context', {
        command: 'widget.toggleLogScale',
        title: 'Log scale',
        group: 'view',
        when: (widget) => widget.logScale !== undefined,
        toggled: (widget) => widget.logScale === true,
      }),
    );
  }

  dispose(): void {
    for (const registration of this.#registrations) registration.dispose();
  }

  registerWidget<T extends WidgetType>(type: T, renderer: WidgetRenderer<T>): Disposable {
    if (this.#renderers.has(type)) throw new Error(`There is a renderer for the widget type ${type} already`);
    this.#renderers.set(type, renderer);
    return new Disposable(() => this.#renderers.delete(type));
  }

  /** Renders `widget` into `el` until disposed; a type without renderer, or a renderer that throws, shows its error there. */
  render(el: HTMLElement, widget: WidgetNode): Disposable {
    const renderer = this.#renderers.get(widget.type);
    if (!renderer) {
      showWidgetError(el, new Error('no renderer for this widget type'), widget);
      return new Disposable(() => el.replaceChildren());
    }
    try {
      const rendered = renderer(el, widget, new RenderedWidget(widget, this, this.query, this.ui));
      return new Disposable(() => {
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
  logScale: boolean | undefined;
  #onLogScale: ((on: boolean) => void) | undefined;

  constructor(
    readonly widget: WidgetNode,
    private readonly host: WidgetsHost,
    readonly state: QueryApi,
    private readonly ui: Pick<UiApi, 'showContextMenu' | 'registerMenuItem'>,
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

  offerLogScale(on: boolean, onChange: (on: boolean) => void): void {
    this.logScale = on;
    this.#onLogScale = onChange;
  }

  setLogScale(on: boolean): void {
    if (!this.#onLogScale) return;
    this.logScale = on;
    this.#onLogScale(on);
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
