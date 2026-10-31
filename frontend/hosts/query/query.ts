import type { Event } from '../../core/event-emitter/event-emitter';

/**
 * The state every query of a tab's page depends on: its time range and auto refresh, its filters, the values of its
 * form widgets. Each tab has its own, in the tab's URL (`?time=1h&f=<key>&sql=…&wp=…&refresh=30`, `f` and `sql` one per chip), so a link
 * opens the page as it was shared; the browser's back button goes to the state before. What an extension keeps in the
 * URL it registers (`registerState`), for every tab. Widgets query again on `onDidRequestRefresh` and send
 * `requestParams()` along; extensions get the active tab's (`activeQuery`).
 */
export interface QueryApi {
  readonly time: TimeModel;
  readonly filters: FiltersModel;
  readonly params: ParamsModel;
  /**
   * Keeps the state `id` in the URL's keys `spec.keys` of every tab until disposed; one registration per id, and a key
   * in one state only. Gives its value here (to an extension: the active tab's).
   */
  registerState<T>(id: string, spec: QueryStateSpec<T>): QueryState<T> & { dispose(): void };
  /**
   * The value of the state `id` here, as another extension registered it (`T`: the type its spec gives); `undefined`
   * while none is registered.
   */
  state<T>(id: string): QueryState<T> | undefined;
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

/** A state's value in one tab (`registerState`). */
export interface QueryState<T> {
  get(): T;
  /** Sets `value`; one the URL holds as it holds the value now changes nothing. */
  set(value: T): void;
  /** Fires when the value changed: set, or loaded from the tab's URL (another page, back and forward), or another tab shown. */
  readonly onDidChange: Event<void>;
}

/** How a state is kept in the URL (`registerState`), and whether the data handlers read it. */
export interface QueryStateSpec<T> {
  /** The URL's keys it is kept in (`['f', 'sql']`). */
  readonly keys: readonly string[];
  /** The value the URL's keys hold (`url`, the tab's query string); the default for what they lack. */
  parse(url: URLSearchParams): T;
  /** The entries of the URL that hold `value`, in order (`[['refresh', '30']]`); none for the default. */
  format(value: T): QueryEntries;
  /**
   * What the data handlers read of `value` (`requestParams`); a state without it is not sent, and its change queries
   * nothing again (auto refresh).
   */
  request?(value: T): QueryEntries;
}

/** Entries of a query string, in order (`[['f', '<key>'], ['sql', 'a > 1']]`). */
export type QueryEntries = readonly (readonly [string, string])[];

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
   * chart, `time-library/formatTime`) or relative to now, `now-6h` (the time picker).
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
 * (`page.json`'s `key`, or `<page>/button`), which every query that takes filters applies. The client only keeps and
 * sends its key; what the key says of itself (its label, field or button) is the filters extension's to read.
 */
export interface Pill {
  /** What the URL holds (`?f=<key>`): the signed pill. */
  readonly key: string;
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

export { QueryHost, QueryStates, parseSearch, formatSearch, type SearchState } from './query-impl';
export { activeQuery, type ActiveQuerySource } from './active-query';
