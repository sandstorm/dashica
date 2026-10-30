import type { Event } from '../../core/event-emitter/event-emitter';

/**
 * The state every query of the shown page depends on: its time range and auto refresh, its SQL filter, the values of
 * its form widgets. It lives in the URL (`?time=1h&sql=…&wp=…&refresh=30`),
 * so a link opens the page as it was shared; the browser's back button goes to the state before. Widgets query again
 * on `onDidRequestRefresh` and send `requestParams()` along.
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
   * What a data handler reads from the query string: the keys of the page's URL (`time`, `range`, `sql`, `wp`), with
   * `time` also when it is the page's default.
   */
  requestParams(): URLSearchParams;
}

export interface TimeModel {
  /** A preset as a Go duration (`1h`, `168h`), or `custom` for `custom`. */
  readonly range: string;
  /** The custom range as the server reads it (`2026-10-29 10:00 to now-1h`); '' unless `range` is `custom`. */
  readonly custom: string;
  /** The seconds between two automatic refreshes, paused while the tab is hidden; `undefined`: no auto refresh. */
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
  /** The SQL condition every query of the page adds to its WHERE (`status >= 500 AND path LIKE '/api%'`); '' for none. */
  readonly sql: string;
  setSql(sql: string): void;
  /** Adds `condition` to the SQL filter with AND (a filter button, "Filter: Equals this value" in a table). */
  add(condition: string): void;
  readonly onDidChange: Event<void>;
}

/** The values of the page's form widgets by name, sent to ClickHouse as query parameters (`{path:String}`). */
export interface ParamsModel {
  readonly values: Readonly<Record<string, string>>;
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  readonly onDidChange: Event<void>;
}

export { QueryHost, formatTime } from './query-impl';
