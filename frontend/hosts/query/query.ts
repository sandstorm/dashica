import type { Event } from '../../core/event-emitter/event-emitter';

/**
 * The state every query of a tab's page depends on: its time range and auto refresh, its filters, the values of its
 * form widgets. Each tab has its own, in the tab's URL (`?time=1h&f=<key>&sql=…&wp=…&refresh=30`, `f` and `sql` one per chip), so a link
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
  /** The chips, in the order they were added, as the URL holds them (`?f=<key>&sql=status >= 500`). */
  readonly chips: readonly FilterChip[];
  /** Adds the SQL chip `condition` ("Filter: Contains this value" in a table); once, when it is there already. */
  add(condition: string): void;
  /** Adds the pill `pill` (as a widget's `/pill` answered it, or a filter button's); once, when its key is there already. */
  add(pill: Pill): void;
  /**
   * Puts `chip` in place of the chip at `index` (an edit); a SQL chip of only spaces removes it, and so does a chip
   * that is there already (once in the URL, as `add` keeps it).
   */
  replace(index: number, chip: FilterChip): void;
  /** Removes the chip at index `which` of `chips`, or every chip `which` holds for (a released filter button's), in one change. */
  remove(which: number | ((chip: FilterChip) => boolean)): void;
  /** Removes every chip. */
  clear(): void;
  readonly onDidChange: Event<void>;
}

/** `eq`: the field equals `value` (Filter by …); `ne`: it differs (Exclude …). */
export type FilterOp = 'eq' | 'ne';

/** A chip of the filter bar: a pill (`?f=`), or a SQL condition every query of the page adds to its WHERE (`?sql=`). */
export type FilterChip = PillFilter | SqlFilter;

/**
 * A pill: a condition on a table that the server wrote from a widget's field and signed (`<dataUrl>/pill`); every
 * chart on that table applies it, the others say they ignore it. Or a filter button's condition, signed the same
 * (`page.json`'s `key`, or `<page>/button`; `pillButton`), which every query that takes filters applies. The client
 * only keeps and sends its key.
 */
export interface Pill {
  /** What the URL holds (`?f=<key>`): the signed pill, its label readable in it (`pillLabel`). */
  readonly key: string;
  /** The chip's text: `customer = acme`, `customer ≠ acme`. */
  readonly label: string;
}

/** What a field's pill filters (`pillField`): the rows of `table` where `field` shows `value` (`eq`) or does not (`ne`). */
export interface PillField {
  /** The ClickHouse connection of `table` (`default`). */
  readonly connection: string;
  /** With its database: `default.http_logs`. */
  readonly table: string;
  /** The alias of the field (`host`). */
  readonly field: string;
  readonly op: FilterOp;
  /** As the field shows it (`acme`); '' for an empty one. */
  readonly value: string;
}

export interface PillFilter extends Pill {
  readonly kind: 'pill';
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

export { QueryHost, formatTime, parseSearch, formatSearch, pillLabel, pillButton, pillField, type QueryState } from './query-impl';
export { activeQuery, type ActiveQuerySource } from './active-query';
