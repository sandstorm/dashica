// See WidgetsApi in widgets.ts.
import * as Arrow from 'apache-arrow';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { Commands } from '../commands/commands';
import type { ActiveQuerySource, QueryApi } from '../query/query';
import type { MenuAnchor, UiApi } from '../ui/ui';
import type {
  DataPoint,
  DataPointMenuItem,
  DataPointMenuProvider,
  QueryResult,
  RenderedWidget,
  WidgetContext,
  WidgetDecoration,
  WidgetDecorationProvider,
  WidgetMenuContext,
  WidgetRenderer,
  WidgetsApi,
  WidgetStatus,
} from './widgets';
import './widgets.css';

/**
 * The workbench's `WidgetsApi`, and how the page renders its widgets (`render`). The active widget of each tab is kept
 * under the tab's query state; `tabs` tells which tab is active. Each rendered widget with data is a `WidgetInstance`:
 * its renderer's context and, as `active`, the widget itself. The decoration providers are asked by each instance when
 * its query answered (`decorationsOf`), and for every rendered instance when one fires; the data point menu providers
 * each time a data point menu is shown, whose chosen item runs through `commands`.
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
  readonly #providers: WidgetDecorationProvider[] = [];
  /** The widgets rendered now, asked again when a provider fires. */
  readonly #rendered = new Set<WidgetInstance>();
  readonly #dataPointMenuProviders: DataPointMenuProvider[] = [];

  constructor(
    private readonly ui: Pick<UiApi, 'showContextMenu' | 'showQuickPick'>,
    private readonly commands: Pick<Commands, 'executeCommand'>,
    private readonly tabs: ActiveQuerySource,
  ) {
    this.#onDidChangeTabs = tabs.onDidChangeTabs(() => this.#tell());
  }

  get active(): RenderedWidget | undefined {
    return this.#active.get(this.tabs.activeQuery);
  }

  registerWidget<T extends WidgetType>(type: T, renderer: WidgetRenderer<T>): Disposable {
    if (this.#renderers.has(type)) throw new Error(`There is a renderer for the widget type ${type} already`);
    this.#renderers.set(type, renderer);
    return new Disposable(() => this.#renderers.delete(type));
  }

  /** Renders `widget` into `widgetContainer` with `query` until disposed; a type without renderer, or a renderer that throws, shows its error there. */
  render(widgetContainer: HTMLElement, widget: WidgetNode, query: QueryApi): Disposable {
    if ('dataUrl' in widget && widget.dataUrl) widgetContainer.dataset.dataUrl = widget.dataUrl;
    const renderer = this.#renderers.get(widget.type);
    if (!renderer) {
      showWidgetError(widgetContainer, new Error('no renderer for this widget type'), widget);
      return new Disposable(() => widgetContainer.replaceChildren());
    }
    const ctx = new WidgetInstance(widget, widgetContainer, this, query, this.ui);
    this.#rendered.add(ctx);
    try {
      const rendered = renderer(widgetContainer, widget, ctx);
      const listening = 'dataUrl' in widget && widget.dataUrl ? this.#activateOn(widgetContainer, ctx) : Disposable.from();
      return new Disposable(() => {
        listening.dispose();
        this.deactivate(ctx);
        this.#rendered.delete(ctx);
        rendered.dispose();
        ctx.dispose();
        widgetContainer.replaceChildren();
      });
    } catch (error) {
      // a widget that failed to render is no rendered one: nothing redecorates it
      this.#rendered.delete(ctx);
      ctx.dispose();
      showWidgetError(widgetContainer, error, widget);
      return new Disposable(() => widgetContainer.replaceChildren());
    }
  }

  /**
   * A press or the focus anywhere in `widgetContainer` makes `ctx` active, unless it lands in a widget with data inside
   * it. The press is heard on its way down (capture), since a chart may stop the presses on its marks.
   */
  #activateOn(widgetContainer: HTMLElement, ctx: WidgetInstance): Disposable {
    const onEvent = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-data-url]') === widgetContainer) this.activate(ctx);
    };
    widgetContainer.addEventListener('pointerdown', onEvent, true);
    widgetContainer.addEventListener('focusin', onEvent);
    return new Disposable(() => {
      widgetContainer.removeEventListener('pointerdown', onEvent, true);
      widgetContainer.removeEventListener('focusin', onEvent);
    });
  }

  /** Makes `widget` its tab's active widget, outlining its element in place of the one before. */
  activate(widget: WidgetInstance): void {
    const before = this.#active.get(widget.query);
    if (before === widget) return;
    before?.widgetContainer.classList.remove(ACTIVE);
    widget.widgetContainer.classList.add(ACTIVE);
    this.#active.set(widget.query, widget);
    this.#tell();
  }

  /** `widget` is removed: its tab has no active widget if it was that one. */
  deactivate(widget: WidgetInstance): void {
    if (this.#active.get(widget.query) !== widget) return;
    widget.widgetContainer.classList.remove(ACTIVE);
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

  registerDecorationProvider(provider: WidgetDecorationProvider): Disposable {
    this.#providers.push(provider);
    const listening = provider.onDidChangeDecorations?.(() => this.#askProvidersAgain());
    this.#askProvidersAgain();
    return new Disposable(() => {
      listening?.dispose();
      this.#providers.splice(this.#providers.indexOf(provider), 1);
      this.#askProvidersAgain();
    });
  }

  /**
   * The decorations of `widget` for its answer `result`, of every provider in order; a provider that throws adds
   * none (its error goes to the console).
   */
  decorationsOf(widget: RenderedWidget, result: QueryResult): readonly WidgetDecoration[] {
    return this.#providers.flatMap((provider) => {
      try {
        return provider.provideDecorations(widget, result) ?? [];
      } catch (error) {
        console.error('A widget decoration provider failed:', error);
        return [];
      }
    });
  }

  /** Asks the providers again for each rendered widget. */
  #askProvidersAgain(): void {
    for (const widget of this.#rendered) widget.redecorate();
  }

  registerDataPointMenuProvider(provider: DataPointMenuProvider): Disposable {
    this.#dataPointMenuProviders.push(provider);
    return new Disposable(() => this.#dataPointMenuProviders.splice(this.#dataPointMenuProviders.indexOf(provider), 1));
  }

  showDataPointMenu(widget: WidgetMenuContext, at: MenuAnchor, dataPoints: readonly DataPoint[]): void {
    if (dataPoints.length === 0) return;
    const answers = this.#dataPointMenuProviders.map((provider) => {
      try {
        return provider.provideDataPointMenuItems(widget, dataPoints);
      } catch (error) {
        console.error('A data point menu provider failed:', error);
        return undefined;
      }
    });
    // the items at once when every provider answered so; else the menu waits for them, busy, and hides should none come
    if (!answers.some((answer) => answer instanceof Promise)) {
      const items = answers.flatMap((answer) => (answer as readonly DataPointMenuItem[] | undefined) ?? []);
      if (items.length > 0) this.#showDataPointMenuItems(items, at);
      return;
    }
    const items = Promise.all(
      answers.map((answer) =>
        Promise.resolve(answer).then(
          (given) => given ?? [],
          (error: unknown) => (console.error('A data point menu provider failed:', error), []),
        ),
      ),
    );
    this.#showDataPointMenuItems(items.then((lists) => lists.flat()), at);
  }

  /** `items` in the quick pick as a menu at `at`; the chosen one's command runs while the menu stays, busy. */
  #showDataPointMenuItems(items: readonly DataPointMenuItem[] | Promise<readonly DataPointMenuItem[]>, at: MenuAnchor): void {
    this.ui
      .showQuickPick(items, {
        anchor: at,
        title: 'Data point',
        menu: true,
        accept: (item) => this.commands.executeCommand(item.command, ...(item.arguments ?? [])),
      })
      .catch((error: unknown) => console.error('The data point menu failed:', error));
  }

  dispose(): void {
    this.#onDidChangeTabs.dispose();
    this.#onDidChangeActive.dispose();
    this.#active.clear();
  }
}

/** Shows `error` in `widgetContainer` in place of the widget: its message and the widget's type. */
function showWidgetError(widgetContainer: HTMLElement, error: unknown, widget: Pick<WidgetNode, 'type'>): void {
  const message = error instanceof Error ? error.message : String(error);
  const errorElement = widgetContainer.ownerDocument.createElement('div');
  errorElement.className = 'd-widget-error';
  errorElement.textContent = `${message} (${widget.type})`;
  widgetContainer.replaceChildren(errorElement);
}

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
  #decorations: readonly WidgetDecoration[] = [];
  readonly #onDidChangeDecorations = new EventEmitter<void>();
  readonly onDidChangeDecorations = this.#onDidChangeDecorations.event;

  constructor(
    readonly widget: WidgetNode,
    /** The element it is rendered into, outlined while it is active. */
    readonly widgetContainer: HTMLElement,
    private readonly host: WidgetsHost,
    readonly query: QueryApi,
    private readonly ui: Pick<UiApi, 'showContextMenu'>,
  ) {}

  get status(): WidgetStatus {
    return this.#status;
  }

  get decorations(): readonly WidgetDecoration[] {
    return this.#decorations;
  }

  /** Asks the providers again for the last answer, while that is the status shown; none after a failed query. */
  redecorate(): void {
    this.#setDecorations(this.#settled.kind === 'done' && this.lastResult ? this.host.decorationsOf(this, this.lastResult) : []);
  }

  #setDecorations(decorations: readonly WidgetDecoration[]): void {
    if (decorations.length === 0 && this.#decorations.length === 0) return;
    this.#decorations = decorations;
    this.#onDidChangeDecorations.fire();
  }

  url(path: string): string {
    if (!('dataUrl' in this.widget)) throw new Error(`the widget ${this.widget.type} has no data`);
    return `${this.widget.dataUrl}${path}?${this.query.requestParams()}`;
  }

  /**
   * Queries `/query`; the status tells how the latest call goes, an aborted latest call puts back the last answer's.
   * An answer is decorated before its status is told, a failure clears the decorations.
   */
  async runQuery(signal?: AbortSignal): Promise<QueryResult> {
    const turn = ++this.#queries;
    const started = performance.now();
    this.#setStatus({ kind: 'loading' });
    let result: QueryResult;
    try {
      result = await fetchQueryResult(this.url('/query'), signal);
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      if (turn === this.#queries && !signal?.aborted) this.#setDecorations([]);
      if (turn === this.#queries) this.#setStatus(signal?.aborted ? this.#settled : { kind: 'error', message: error instanceof Error ? error.message : String(error), ms });
      throw error;
    }
    if (turn !== this.#queries) return result;
    const ms = Math.round(performance.now() - started);
    this.lastResult = result;
    this.#setDecorations(this.host.decorationsOf(this, result));
    this.#setStatus({ kind: 'done', rows: result.numRows, ms });
    return result;
  }

  #setStatus(status: WidgetStatus): void {
    this.#status = status;
    if (status.kind !== 'loading') this.#settled = status;
    this.#onDidChangeStatus.fire();
  }

  renderChild(childContainer: HTMLElement, child: WidgetNode): Disposable {
    return this.host.render(childContainer, child, this.query);
  }

  showMenu(menuId: string, anchor: MenuAnchor, context?: object): void {
    const shown = context ? { widget: this.widget, url: (path: string) => this.url(path), lastResult: this.lastResult, ...context } : this;
    this.ui.showContextMenu(menuId, { anchor, title: this.widget.type, context: shown, args: [shown] });
  }

  showDataPointMenu(at: MenuAnchor, dataPoints: readonly DataPoint[]): void {
    this.host.showDataPointMenu(this, at, dataPoints);
  }

  /** It is removed: its events end. */
  dispose(): void {
    this.#onDidChangeStatus.dispose();
    this.#onDidChangeDecorations.dispose();
  }
}

/** The class of the active widget's element in each tab: its outline. */
const ACTIVE = 'd-widget--active';

/** The Arrow table at `url` with the answer's headers; an empty table for a 204 (no content). */
async function fetchQueryResult(url: string, signal?: AbortSignal): Promise<QueryResult> {
  const response = await fetch(url, { signal });
  if (response.status !== 200 && response.status !== 204) throw new Error(await response.text());
  const table = response.status === 204 ? new Arrow.Table() : await Arrow.tableFromIPC(response);
  return Object.assign(table, { headers: response.headers });
}
