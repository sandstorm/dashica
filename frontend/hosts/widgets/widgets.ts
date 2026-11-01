import type { Table } from 'apache-arrow';
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { WidgetNode, WidgetType } from '../../generated/zz_generated.dashica';
import type { QueryApi } from '../query/query';
import type { MenuAnchor } from '../ui/ui';

/**
 * How each widget type of `page.json` is rendered: the extension of a widget type (`timeBar`, `grid`, …) registers its
 * renderer, and a page renders its widgets through them with its tab's query state. A renderer gets the widget's props
 * and a `WidgetContext`: that query state (`query`), its data (`runQuery()`), its children, its menu. Charts put
 * themselves into the chart library's `ChartFrame` (title, spinner, error, menu button).
 * Each tab has an active widget: the widget with data the viewer last pressed or focused in (its menu button, a mark,
 * a table cell or checkbox), outlined. As VS Code's `window.activeTextEditor`, `active` refers to the active tab's one,
 * and the widget itself tells its status with its own event: Debug follows it. What only one widget type has (a
 * table's ticked rows, what a click on a mark offers) is that type's own; it tells other extensions by command (the
 * table: `details.showRecords`).
 */
export interface WidgetsApi {
  /** Renders the widgets of `type` until disposed; one renderer per type. */
  registerWidget<T extends WidgetType>(type: T, renderer: WidgetRenderer<T>): Disposable;
  /**
   * Renders `widget` (one of a page's widgets) into `el` until disposed, with `query` (its tab's query state,
   * `PageContext.query`); a type without renderer shows its error there. A widget with data marks `el` with its URL
   * (`data-data-url="/p/shop/api/3"`), where a link to the chart finds it.
   */
  render(el: HTMLElement, widget: WidgetNode, query: QueryApi): Disposable;
  /**
   * The active tab's active widget, the same object as long as it is rendered; `undefined` while the viewer has not
   * pressed or focused in a widget with data of that tab, or after it was removed.
   */
  readonly active: RenderedWidget | undefined;
  /** Fires when `active` is another widget: another one pressed, another tab shown, the widget removed. */
  readonly onDidChangeActive: Event<void>;
}

/**
 * A widget with data as it is rendered (`WidgetsApi.active`): what its menu is shown for, and its query's status with
 * the event that tells its change. Its event ends when it is removed.
 */
export interface RenderedWidget extends WidgetMenuContext {
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

/** Fills `el` with `widget`; disposing the result stops what it started (queries, listeners). `el` is emptied after. */
export type WidgetRenderer<T extends WidgetType> = (el: HTMLElement, widget: WidgetOf<T>, ctx: WidgetContext) => { dispose(): unknown };

/** What a widget's renderer gets to work with. */
export interface WidgetContext {
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
  /** Renders `child` (a grid's area, a group's widget) into `el`. */
  renderChild(el: HTMLElement, child: WidgetNode): Disposable;
  /**
   * Pops up the menu `menuId` at `anchor` (an element, or a point such as a right click's), for this widget: its
   * context and its entries' argument are the widget's `WidgetMenuContext` with the fields of `context` (a table
   * cell's column and value). The chart frame's "More" shows `widget/context`, a table's cell `table/cell`.
   */
  showMenu(menuId: string, anchor: MenuAnchor, context?: object): void;
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
 * next to it (the chart library's time range and column types, the alert chart's thresholds, Debug's summary).
 */
export type QueryResult = Table & {
  readonly headers: Headers;
};

export { WidgetsHost } from './widgets-impl';
