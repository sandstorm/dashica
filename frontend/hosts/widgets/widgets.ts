import type { Table } from 'apache-arrow';
import type { Disposable } from '../../core/disposable/disposable';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { FilterOp, QueryApi } from '../query/query';
import type { MenuAnchor } from '../ui/ui';

/**
 * How each widget type of `page.json` is rendered: the extension of a widget type (`timeBar`, `grid`, …) registers its
 * renderer, and the page renders its widgets through them. A renderer gets the widget's props and a `WidgetContext`:
 * the page's query state (`state`), its data (`query()`), its children, its menu and the page's one selection
 * (`select`, or `choose` among candidates). Charts put themselves into one `ChartFrame` (title, spinner, error, menu
 * button).
 */
export interface WidgetsApi {
  /** Renders the widgets of `type` until disposed; one renderer per type. */
  registerWidget<T extends WidgetType>(type: T, renderer: WidgetRenderer<T>): Disposable;
  /**
   * Renders `widget` (one of a page's widgets) into `el` until disposed; a type without renderer shows its error there.
   * A widget with data marks `el` with its URL (`data-data-url="/p/shop/api/3"`), where a link to the chart finds it.
   */
  render(el: HTMLElement, widget: WidgetNode): Disposable;
  /** What the viewer selected on a chart, one at a time; `undefined` while nothing is. */
  readonly selection: Selection | undefined;
  /**
   * Selects `selection` in place of any other, on a view of the chart `selection.widgetId` outside the page's widgets
   * (the Explore view); it ends as one on a chart does.
   */
  select(selection: Selection): void;
  /** Ends the selection; its floating bar goes away. */
  clearSelection(): void;
}

/**
 * What the viewer selected on a chart (`WidgetContext.select`). The floating bar `widget/selection` shows next to it,
 * its context the selection; Escape or a click elsewhere ends it.
 */
export type Selection = CategorySelection;

/** A category's value: a bar's category, its fill, a table cell. */
export interface CategorySelection {
  readonly kind: 'category';
  /** The chart's id on its page, as in its `dataUrl` (`3`). */
  readonly widgetId: string;
  /** The alias of the clicked field's column (`host`), the id of a filter on it. */
  readonly fieldId: string;
  readonly value: string;
  /** What the viewer clicked (a bar); the floating bar sits next to it while it is in the page. */
  readonly anchor: Element;
}

/** A widget as `page.json` has it, for one type (`WidgetOf<'timeBar'>`: its props are `TimeBarProps`). */
export type WidgetOf<T extends WidgetType> = Extract<WidgetNode, { type: T }>;

/** Fills `el` with `widget`; disposing the result stops what it started (queries, listeners). `el` is emptied after. */
export type WidgetRenderer<T extends WidgetType> = (el: HTMLElement, widget: WidgetOf<T>, ctx: WidgetContext) => { dispose(): unknown };

/** What a widget's renderer gets to work with. */
export interface WidgetContext {
  /** The page's time range, filter and params; `state.onDidRequestRefresh`: query again. */
  readonly state: QueryApi;
  /** The widget's data from its handler (`<dataUrl>/query`) with the page's query state; rejects with the server's message. */
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
  /** Selects `selection` on this widget, in place of any other selection on the page. */
  select(selection: Omit<Selection, 'widgetId'>): void;
  /**
   * Pops up `candidates` at `at` (a click's point), one entry per candidate in order ("instance = web-1": its
   * `fieldId` and `value`); choosing one selects it as `select`. Nothing without candidates (an open menu stays).
   */
  choose(at: MenuAnchor, candidates: readonly Omit<Selection, 'widgetId'>[]): void;
  /** Ends the selection, whichever widget it is on. */
  clearSelection(): void;
}

/** What the menu `widget/context` is shown for, also its commands' argument: the widget and what it queried last. */
export interface WidgetMenuContext {
  readonly widget: WidgetNode;
  /** `path` below the widget's handler with the page's query state, as `WidgetContext.url`. */
  url(path: string): string;
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

export { WidgetsHost, showWidgetError } from './widgets-impl';
export { ChartFrame, type ChartFrameOptions, type DrawOptions } from './chart-frame/chart-frame';
