import type { Event } from '../../core/event-emitter/event-emitter';

/**
 * The state every query of a tab's page depends on: its time range and auto refresh, its filters, the values of its
 * form widgets. Each tab has its own, in the tab's URL (`?time=1h&f=host:eq:a&sql=…&wp=…&refresh=30`, `f` and `sql` one per chip), so a link
 * opens the page as it was shared; the browser's back button goes to the state before. Widgets query again on
 * `onDidRequestRefresh` and send `requestParams()` along; extensions get the active tab's (`activeQuery`).
 */
export interface QueryApi {
  readonly time: TimeModel;
  readonly filters: FiltersModel;
  readonly params: ParamsModel;
  /** Fires when the widgets should query again: the time, the filter or a param changed, or `refresh` was called. */
  readonly onDidRequestRefresh: Event<void>;
  /** Asks the widgets to query again with the same state (the refresh button, auto refresh). */
  refresh(): void;
  /**
   * What a data handler reads from the query string: the keys of the page's URL (`time`, `range`, `sql`, `f`, `wp`), with
   * `time` also when it is the page's default.
   */
  requestParams(): URLSearchParams;
}

export interface TimeModel {
  /** A preset as a Go duration (`1h`, `168h`), or `custom` for `custom`. */
  readonly range: string;
  /** The custom range as the server reads it (`2026-10-29 10:00 to now-1h`); '' unless `range` is `custom`. */
  readonly custom: string;
  /** The seconds between two automatic refreshes, paused while the tab or the browser tab is hidden; `undefined`: no auto refresh. */
  readonly autoRefresh: number | undefined;
  setRange(range: string): void;
  /**
   * Sets the range to `custom`, each end a time as the server reads it: `2026-10-29 10:00` (a selection on a time
   * chart, `formatTime`) or relative to now, `now-6h` (the time picker).
   */
  setCustom(from: string, to: string): void;
  setAutoRefresh(seconds: number | undefined): void;
  readonly onDidChange: Event<void>;
}

export interface FiltersModel {
  /** The chips, in the order they were added, as the URL holds them (`?f=host:ne:a&sql=status >= 500`). */
  readonly chips: readonly FilterChip[];
  /** Adds the SQL chip `condition` (a filter button, "Filter: Contains this value" in a table); once, when it is there already. */
  add(condition: string): void;
  /** Adds the structured chip `fieldId` `op` `value` (a clicked column's alias); once, when it is there already. */
  add(fieldId: string, op: FilterOp, value: string): void;
  /** Puts `chip` in place of the chip at `index` (an edit); a SQL chip of only spaces removes it. */
  replace(index: number, chip: FilterChip): void;
  /** Removes the chip at index `which` of `chips`, or every chip `which` holds for (a released filter button's), in one change. */
  remove(which: number | ((chip: FilterChip) => boolean)): void;
  /** Removes every chip. */
  clear(): void;
  readonly onDidChange: Event<void>;
}

/** `eq`: the field equals `value` (Filter by …); `ne`: it differs (Exclude …). */
export type FilterOp = 'eq' | 'ne';

/** A chip of the filter bar: a structured filter (`?f=`), or a SQL condition every query of the page adds to its WHERE (`?sql=`). */
export type FilterChip = FieldFilter | SqlFilter;

/** A structured filter: each chart's query compares what it means by `fieldId` with `value`, bound as a parameter. */
export interface FieldFilter {
  readonly kind: 'field';
  /** The alias of the column the viewer clicked (`host`); a chart that does not know it says so (`ignored`). */
  readonly fieldId: string;
  readonly op: FilterOp;
  readonly value: string;
}

/** A SQL condition (`duration > 2000`); several AND together, each in its own parentheses. */
export interface SqlFilter {
  readonly kind: 'sql';
  readonly sql: string;
}

/** The values of the page's form widgets by name, sent to ClickHouse as query parameters (`{path:String}`). */
export interface ParamsModel {
  readonly values: Readonly<Record<string, string>>;
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  readonly onDidChange: Event<void>;
}

export { QueryHost, formatTime, parseSearch, formatSearch, type QueryState } from './query-impl';
export { activeQuery, type ActiveQuerySource } from './active-query';
