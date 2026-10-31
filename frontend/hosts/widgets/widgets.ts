import type { Table } from 'apache-arrow';
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { FilterOp, QueryApi } from '../query/query';
import type { MenuAnchor } from '../ui/ui';

/**
 * How each widget type of `page.json` is rendered: the extension of a widget type (`timeBar`, `grid`, …) registers its
 * renderer, and a page renders its widgets through them with its tab's query state. A renderer gets the widget's props
 * and a `WidgetContext`: that query state (`state`), its data (`query()`), its children, its menu, the filters a
 * click offers (`offerFilters`), its selected records (`selectRecords`: a table's ticked rows).
 * Charts put themselves into one `ChartFrame` (title, spinner, error, menu button). Each tab has an active widget: the
 * widget with data the viewer last pressed or focused in (its menu button, a mark, a table cell) or ticked records on,
 * outlined. As VS Code's `window.activeTextEditor`, `active` refers to the active tab's one, and the widget itself
 * tells its status and its records, each with its own event: Debug follows its status, Details its records.
 */
export interface WidgetsApi {
  /** Renders the widgets of `type` until disposed; one renderer per type. */
  registerWidget<T extends WidgetType>(type: T, renderer: WidgetRenderer<T>): Disposable;
  /**
   * Renders `widget` (one of a page's widgets) into `el` until disposed, with `state` (its tab's query state,
   * `PageContext.query`); a type without renderer shows its error there. A widget with data marks `el` with its URL
   * (`data-data-url="/p/shop/api/3"`), where a link to the chart finds it.
   */
  render(el: HTMLElement, widget: WidgetNode, state: QueryApi): Disposable;
  /**
   * Offers, in a quick pick "Filter" at `at`, to filter by each of `candidates` ("status = 500" with a filter icon) or
   * to exclude it (the same with a minus icon), in order; choosing one adds it to `state`'s filters at once. Nothing
   * without candidates. For a view of a chart outside the page's widgets (the Explore view), as `offerFilters` of a
   * widget's context.
   */
  offerFilters(at: MenuAnchor, candidates: readonly FilterCandidate[], state: QueryApi): void;
  /**
   * The active tab's active widget, the same object as long as it is rendered; `undefined` while the viewer has not
   * pressed or focused in a widget with data of that tab, or after it was removed.
   */
  readonly active: RenderedWidget | undefined;
  /** Fires when `active` is another widget: another one pressed, another tab shown, the widget removed. */
  readonly onDidChangeActive: Event<void>;
}

/**
 * A widget with data as it is rendered (`WidgetsApi.active`): what its menu is shown for, its query's status and its
 * selected records, each with the event that tells their change. Its events end when it is removed.
 */
export interface RenderedWidget extends WidgetMenuContext {
  readonly status: WidgetStatus;
  /** Fires when its query started, answered or failed. */
  readonly onDidChangeStatus: Event<void>;
  /** The records the viewer selected on it (a table's ticked rows, in the order ticked); empty while none. */
  readonly records: readonly WidgetRecord[];
  /** Fires when its selected records changed. */
  readonly onDidChangeRecords: Event<void>;
}

/** One record of a widget's result, by column name (`{ path: '/api', status: 500 }`). */
export type WidgetRecord = Readonly<Record<string, unknown>>;

/** How a widget's last query went: not asked yet, running, answered (rows, the time until the answer), failed. */
export type WidgetStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'done'; readonly rows: number; readonly ms: number; readonly diagnostics: Diagnostics }
  | { readonly kind: 'error'; readonly message: string; readonly ms: number };

/** A category's value a click offers to filter by (a bar's category, its fill, a table cell). */
export interface FilterCandidate {
  /** The alias of the clicked field's column (`host`), the id of a filter on it. */
  readonly fieldId: string;
  readonly value: string;
}

/** A widget as `page.json` has it, for one type (`WidgetOf<'timeBar'>`: its props are `TimeBarProps`). */
export type WidgetOf<T extends WidgetType> = Extract<WidgetNode, { type: T }>;

/** Fills `el` with `widget`; disposing the result stops what it started (queries, listeners). `el` is emptied after. */
export type WidgetRenderer<T extends WidgetType> = (el: HTMLElement, widget: WidgetOf<T>, ctx: WidgetContext) => { dispose(): unknown };

/** What a widget's renderer gets to work with. */
export interface WidgetContext {
  /** The time range, filter and params of the widget's tab; `state.onDidRequestRefresh`: query again. */
  readonly state: QueryApi;
  /**
   * The widget's data from its handler (`<dataUrl>/query`) with the page's query state; rejects with the server's
   * message. The widget's status and `lastResult` follow the latest call only: an earlier one still answering changes
   * neither, an aborted latest one puts back the status of the last answer.
   */
  query(signal?: AbortSignal): Promise<QueryResult>;
  /** `path` below the widget's handler with the page's query state (`/p/shop/api/8/speedscope-query?time=1h&sql=…`). */
  url(path: string): string;
  /** Renders `child` (a grid's area, a group's widget) into `el`. */
  renderChild(el: HTMLElement, child: WidgetNode): Disposable;
  /**
   * Pops up the menu `menuId` at `anchor` (an element, or a point such as a right click's), for this widget: its
   * context and its entries' argument are the widget's `WidgetMenuContext` with the fields of `context` (a table
   * cell's column and value). The chart frame's "More" shows `widget/context`, a table's cell `table/cell`.
   */
  showMenu(menuId: string, anchor: MenuAnchor, context?: object): void;
  /** Adds the structured filter `fieldId` `op` `value` to the page (`fieldId`: a column's alias). */
  addFilter(fieldId: string, op: FilterOp, value: string): void;
  /**
   * Offers to filter by or exclude each of `candidates` at `at` (a click's point, a cell), as `WidgetsApi.offerFilters`
   * with the widget's query state: choosing one adds the filter at once.
   */
  offerFilters(at: MenuAnchor, candidates: readonly FilterCandidate[]): void;
  /**
   * Makes `records` the widget's selected records (`RenderedWidget.records`), in place of those before; with records,
   * the widget becomes its tab's active widget.
   */
  selectRecords(records: readonly WidgetRecord[]): void;
}

/** What the menu `widget/context` is shown for, also its commands' argument: the widget and what it queried last. */
export interface WidgetMenuContext {
  readonly widget: WidgetNode;
  /** `path` below the widget's handler with the page's query state, as `WidgetContext.url`. */
  url(path: string): string;
  /** What the latest `query()` answered; `undefined` before. */
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
  /** What the chart did with the page's filters (X-Dashica-Diagnostics); empty when it has nothing to say. */
  dashicaDiagnostics?: Diagnostics;
};

/** What a chart tells about one answer: the filters it does not interpret, or that it did not run. */
export interface Diagnostics {
  /** The ids of the page's structured filters the chart ignores (`['host']`), in the order of the URL. */
  readonly ignored?: readonly string[];
  /** Why the chart did not run; then its result has no rows. */
  readonly skipped?: string;
}

export { WidgetsHost, showWidgetError, widgetTitle } from './widgets-impl';
export { ChartFrame, type ChartFrameOptions, type DrawOptions } from './chart-frame/chart-frame';
