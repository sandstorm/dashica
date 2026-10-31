import type { Event } from '../../core/event-emitter/event-emitter';
import type { PageJson } from '../../generated/zz_generated.dashica';

/**
 * The state every query of a tab's page depends on, kept in the tab's URL: each tab has its own, so a link opens the
 * page as it was shared, and the browser's back button goes to the state before. The host knows no key of its own;
 * each extension registers what it keeps (`registerState`, for every tab): the time range (`time-range`, `?time=1h`),
 * the auto refresh (`refresh`, `?refresh=30`), the filter chips (`filters`, `?f=<key>&sql=…`), the dashboard's params
 * (`dashboardPage`, `?wp=…`). Others read a state by its id (`state`), never by importing its extension. Widgets
 * query again on `onDidRequestRefresh` and send `requestParams()` along; extensions get the active tab's
 * (`activeQuery`).
 */
export interface QueryApi {
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
  /** Fires when the widgets should query again: a state the data handlers read changed, or `refresh` was called. */
  readonly onDidRequestRefresh: Event<void>;
  /** Asks the widgets to query again with the same state (the refresh button, auto refresh). */
  refresh(): void;
  /**
   * What the data handlers read: each registered state's `request` entries, in the order registered (`time`, `f`,
   * `sql`, `wp`), `time` also when it is the page's default.
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
  /**
   * The value the URL's keys hold (`url`, the tab's query string); the default for what they lack, which may be the
   * page's (`page`, the page the tab shows: its `defaultTime`; `undefined` before one is).
   */
  parse(url: URLSearchParams, page: PageJson | undefined): T;
  /** The entries of the URL that hold `value`, in order (`[['refresh', '30']]`); none for the default (`page`: as `parse`). */
  format(value: T, page: PageJson | undefined): QueryEntries;
  /**
   * What the data handlers read of `value` (`requestParams`); a state without it is not sent, and its change queries
   * nothing again (auto refresh).
   */
  request?(value: T): QueryEntries;
}

/** Entries of a query string, in order (`[['f', '<key>'], ['sql', 'a > 1']]`). */
export type QueryEntries = readonly (readonly [string, string])[];

export { QueryHost, QueryStates } from './query-impl';
export { activeQuery, type ActiveQuerySource } from './active-query';
