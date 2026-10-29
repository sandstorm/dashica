import type { Table } from 'apache-arrow';
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { FiltersModel, ParamsModel, TimeModel, ViewOptionsModel } from '../query/query';

/**
 * How each widget type of `page.json` is rendered: the extension of a widget type (`timeBar`, `grid`, …) registers its
 * renderer, and the page renders its widgets through them. A renderer gets the widget's props and a `WidgetContext`:
 * the page's query state, its data (`query()`), its children and its menu. Charts put themselves into one
 * `ChartFrame` (title, spinner, error, menu button).
 */
export interface WidgetsApi {
  /** Renders the widgets of `type` until disposed; one renderer per type. */
  registerWidget<T extends WidgetType>(type: T, renderer: WidgetRenderer<T>): Disposable;
}

/** A widget as `page.json` has it, for one type (`WidgetOf<'timeBar'>`: its props are `TimeBarProps`). */
export type WidgetOf<T extends WidgetType> = Extract<WidgetNode, { type: T }>;

export interface WidgetRenderer<T extends WidgetType> {
  /** Fills `el` with `widget`; disposing the result stops what it started (queries, listeners). `el` is emptied after. */
  render(el: HTMLElement, widget: WidgetOf<T>, ctx: WidgetContext): Disposable;
}

/** What a widget's renderer gets to work with. */
export interface WidgetContext {
  readonly time: TimeModel;
  readonly filters: FiltersModel;
  readonly params: ParamsModel;
  readonly viewOptions: ViewOptionsModel;
  /** Fires when the widget should query again: the time, the filter or a param changed, or the viewer refreshed. */
  readonly onDidRequestRefresh: Event<void>;
  /** The widget's data from its handler (`<dataUrl>/query`) with the page's query state; rejects with the server's message. */
  query(signal?: AbortSignal): Promise<QueryResult>;
  /** `path` below the widget's handler with the page's query state (`/p/wetell/api/8/speedscope-query?filters=…`). */
  url(path: string): string;
  /** Renders `child` (a grid's area, a group's widget) into `el`. */
  renderChild(el: HTMLElement, child: WidgetNode): Disposable;
  /** Pops up the menu `widget/context` at `anchor`; its context is a `WidgetMenuContext`. */
  showMenu(anchor: HTMLElement): void;
}

/** What the menu `widget/context` is shown for, also its commands' argument: the widget and what it queried last. */
export interface WidgetMenuContext {
  readonly widget: WidgetNode;
  /** `path` below the widget's handler with the page's query state, as `WidgetContext.url`. */
  readonly url: (path: string) => string;
  /** What `query()` gave last; `undefined` before. */
  readonly lastResult: QueryResult | undefined;
}

/** A widget's data: the Arrow table its handler answered, and what the server said about it in the headers. */
export type QueryResult = Table & {
  /** The time range the server queried, in ms since the epoch: a time chart's domain. */
  dashicaResolvedTimeRange?: { from: number; to: number } | null;
  /** The bucket size the server picked for an `AutoBucket` time axis, in ms. */
  dashicaBucketSize?: number | null;
  /** ClickHouse's summary of the query: rows and bytes read, elapsed time. */
  clickhouseSummary?: unknown;
  /** The thresholds of an alert, drawn as lines on its chart. */
  dashicaAlertIf?: { value_gt?: number | null; value_lt?: number | null } | null;
};

/** How the charts show their data: `VIEW_LOGARITHMIC` for a log scale. */
export type ViewOptions = 'VIEW_LOGARITHMIC'[];

export { WidgetsHost, showWidgetError } from './widgets-impl';
export { ChartFrame, type ChartFrameOptions, type DrawOptions } from './chart-frame/chart-frame';
