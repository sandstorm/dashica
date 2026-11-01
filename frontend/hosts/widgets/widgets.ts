import type { Table } from 'apache-arrow';
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { QueryApi } from '../query/query';
import type { MenuAnchor, QuickPickItem } from '../ui/ui';

/**
 * How each widget type of `page.json` is rendered: the extension of a widget type (`timeBar`, `grid`, …) registers its
 * renderer, and a page renders its widgets through them with its tab's query state. A renderer gets the widget's props
 * and a `WidgetContext`: that query state (`query`), its data (`runQuery()`), its children, its menu. Charts put
 * themselves into the chart library's `ChartFrame` (title, spinner, error, menu button).
 * Each tab has an active widget: the widget with data the viewer last pressed or focused in (its menu button, a mark,
 * a table cell or checkbox), outlined. `active` refers to the active tab's one, and the widget itself tells its status
 * with its own event: Debug follows it. An extension may decorate a widget's answer (`registerDecorationProvider`): a
 * badge with its tooltip, the drawing muted; the chart frame and Debug show a widget's decorations as they are given.
 * An extension may offer what to do with a widget's data points (`registerDataPointMenuProvider`): a click on a
 * chart's mark, a table's cell shows the items of all providers (`WidgetContext.showDataPointMenu`), the `filters`
 * extension's "status = 500" among them, each running its provider's command. What only one widget type has (a
 * table's ticked rows) is that type's own; it tells other extensions by command (the table: `details.showRecords`).
 */
export interface WidgetsApi {
  /** Renders the widgets of `type` until disposed; one renderer per type. */
  registerWidget<T extends WidgetType>(type: T, renderer: WidgetRenderer<T>): Disposable;
  /**
   * Renders `widget` (one of a page's widgets) into `widgetContainer` until disposed, with `query` (its tab's query
   * state, `PageContext.query`); a type without renderer shows its error there. A widget with data marks
   * `widgetContainer` with its URL (`data-data-url="/p/shop/api/3"`), where a link to the chart finds it.
   */
  render(widgetContainer: HTMLElement, widget: WidgetNode, query: QueryApi): Disposable;
  /**
   * The active tab's active widget, the same object as long as it is rendered; `undefined` while the viewer has not
   * pressed or focused in a widget with data of that tab, or after it was removed.
   */
  readonly active: RenderedWidget | undefined;
  /** Fires when `active` is another widget: another one pressed, another tab shown, the widget removed. */
  readonly onDidChangeActive: Event<void>;
  /**
   * Decorates the widgets' answers until disposed: the host asks `provider` when a widget's query answered, and every
   * answered widget again when `provider` fires its `onDidChangeDecorations`. A widget's decorations are those of all
   * providers, in the order registered.
   */
  registerDecorationProvider(provider: WidgetDecorationProvider): Disposable;
  /**
   * Offers what to do with the widgets' data points until disposed: the host asks `provider` each time a data point
   * menu is shown (`showDataPointMenu`); the menu has the items of all providers, in the order registered.
   */
  registerDataPointMenuProvider(provider: DataPointMenuProvider): Disposable;
  /**
   * Shows the data point menu of `widget` for `dataPoints` at `at` (`WidgetContext.showDataPointMenu`), for a view
   * that shows a widget's data outside of its renderer (an Explore view's chart): every provider is asked in the order
   * registered, one that throws or rejects adds nothing (its error goes to the console); the items show in the quick
   * pick as a menu ("Data point"), busy while a provider's are still to come, and choosing one runs its command with
   * its arguments while the menu stays, busy, its error shown in it. Nothing without items.
   */
  showDataPointMenu(widget: WidgetMenuContext, at: MenuAnchor, dataPoints: readonly DataPoint[]): void;
}

/** What offers to do something with a widget's data points (`WidgetsApi.registerDataPointMenuProvider`). */
export interface DataPointMenuProvider {
  /** The items for `dataPoints` of `widget` (a click's, in order); `undefined` or `[]`: none. */
  provideDataPointMenuItems(widget: WidgetMenuContext, dataPoints: readonly DataPoint[]): readonly DataPointMenuItem[] | Promise<readonly DataPointMenuItem[] | undefined> | undefined;
}

/** A value of a widget's data a click points at: a bar's category, its fill, a table's cell. */
export interface DataPoint {
  /** The alias of its field's column (`host`). */
  readonly field: string;
  /** As a filter compares it: a time as ISO 8601 in UTC (`2026-10-31T10:00:00.000Z`), anything else as it shows. */
  readonly value: string;
  /** The field's ClickHouse type (`DateTime`, `LowCardinality(String)`); unknown without. */
  readonly type?: string;
}

/**
 * An entry of the data point menu: how it shows, as a quick pick item, and the command it runs with `arguments` (the
 * `filters` extension's "status = 500": `filters.addPill`).
 */
export interface DataPointMenuItem extends QuickPickItem {
  readonly command: string;
  readonly arguments?: readonly unknown[];
}

/** What decorates the widgets' answers (`WidgetsApi.registerDecorationProvider`). */
export interface WidgetDecorationProvider {
  /** The decorations of `widget` for its answer `result`; `undefined` or `[]`: none. */
  provideDecorations(widget: RenderedWidget, result: QueryResult): readonly WidgetDecoration[] | undefined;
  /** Fires when its decorations of answers already given may have changed: the host asks it again for each. */
  readonly onDidChangeDecorations?: Event<void>;
}

/**
 * What is shown on a widget about its answer: how it shows (the `filters` extension's "ignores customer = acme",
 * muted); what it means stays its provider's.
 */
export interface WidgetDecoration {
  /** A short text beside the widget's title (`ignores customer = acme`). */
  readonly badge: string;
  /** The badge's hover. */
  readonly tooltip?: string;
  /** Whether the widget is drawn muted while it has the decoration. */
  readonly muted?: boolean;
  /** Who decorates: the id of the provider's extension (`filters`), as Debug lists it. */
  readonly source: string;
}

/** A widget's current decorations, and the event that tells their change: an answered query, a provider that fired. */
export interface Decorated {
  /** Empty before an answer and after a failed query. */
  readonly decorations: readonly WidgetDecoration[];
  readonly onDidChangeDecorations: Event<void>;
}

/**
 * A widget with data as it is rendered (`WidgetsApi.active`): what its menu is shown for, its query's status and its
 * decorations, each with the event that tells its change. Its events end when it is removed.
 */
export interface RenderedWidget extends WidgetMenuContext, Decorated {
  readonly status: WidgetStatus;
  /** Fires when its query started, answered or failed. */
  readonly onDidChangeStatus: Event<void>;
}

/** One record of a widget's result, by column name (`{ path: '/api', status: 500 }`). */
export type WidgetRecord = Readonly<Record<string, unknown>>;

/** How a widget's last query went: not asked yet, running, answered (rows, the time until the answer), failed. */
export type WidgetStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'done'; readonly rows: number; readonly ms: number }
  | { readonly kind: 'error'; readonly message: string; readonly ms: number };

/** A widget as `page.json` has it, for one type (`WidgetOf<'timeBar'>`: its props are `TimeBarProps`). */
export type WidgetOf<T extends WidgetType> = Extract<WidgetNode, { type: T }>;

/** Fills `widgetContainer` with `widget`; disposing the result stops what it started (queries, listeners). `widgetContainer` is emptied after. */
export type WidgetRenderer<T extends WidgetType> = (widgetContainer: HTMLElement, widget: WidgetOf<T>, ctx: WidgetContext) => { dispose(): unknown };

/** What a widget's renderer gets to work with; its decorations for the chart frame. */
export interface WidgetContext extends Decorated {
  /**
   * The query state of the widget's tab: a key's value (`query.get(TIME)`), what the handlers read of it
   * (`requestParams`); `query.onDidRequestRefresh`: query again.
   */
  readonly query: QueryApi;
  /**
   * The widget's data from its handler (`<dataUrl>/query`) with the page's query state; rejects with the server's
   * message. The widget's status and `lastResult` follow the latest call only: an earlier one still answering changes
   * neither, an aborted latest one puts back the status of the last answer.
   */
  runQuery(signal?: AbortSignal): Promise<QueryResult>;
  /** `path` below the widget's handler with the page's query state (`/p/shop/api/8/speedscope-query?time=1h&sql=…`). */
  url(path: string): string;
  /** Renders `child` (a grid's area, a group's widget) into `childContainer`. */
  renderChild(childContainer: HTMLElement, child: WidgetNode): Disposable;
  /**
   * Pops up the menu `menuId` at `anchor` (an element, or a point such as a right click's), for this widget: its
   * context and its entries' argument are the widget's `WidgetMenuContext` with the fields of `context` (a table
   * cell's column and value). The chart frame's "More" shows `widget/context`, a table's cell `table/cell`.
   */
  showMenu(menuId: string, anchor: MenuAnchor, context?: object): void;
  /** Shows this widget's data point menu for `dataPoints` (a click's) at `at`, as `WidgetsApi.showDataPointMenu`. */
  showDataPointMenu(at: MenuAnchor, dataPoints: readonly DataPoint[]): void;
}

/** What the menu `widget/context` is shown for, also its commands' argument: the widget and what it queried last. */
export interface WidgetMenuContext {
  readonly widget: WidgetNode;
  /** `path` below the widget's handler with the page's query state, as `WidgetContext.url`. */
  url(path: string): string;
  /** What the latest `runQuery()` answered; `undefined` before. */
  readonly lastResult: QueryResult | undefined;
}

/**
 * A widget's data: the Arrow table its handler answered, an empty one for a 204 (no content), and the answer's
 * headers as they came. The host reads none of them; what a header says is read by its user, through a pure function
 * next to it, in the extension or library that reads it.
 */
export type QueryResult = Table & {
  readonly headers: Headers;
};

export { WidgetsHost } from './widgets-impl';
