import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { PageJson } from '../../generated/zz_generated.dashica';

/**
 * The state every query of a tab's page depends on, kept in the tab's URL: each tab has its own, so a link opens the
 * page as it was shared, and the browser's back button goes to the state before. The host knows no key of its own;
 * each part of the state is a typed key that carries its URL format (`queryKey`), defined once where the state belongs
 * and imported by its readers: the time range (`TIME`, `?time=1h`), the auto refresh (`REFRESH`, `?refresh=30`), the
 * filter chips (`FILTERS`, `?f=<key>&sql=…`), the dashboard's params (`PARAMS`, `?wp=…`). Widgets query again on
 * `onDidRequestRefresh` and send `requestParams()` along; extensions get the active tab's (`activeQuery`).
 */
export interface QueryApi {
  /** The value of `key` here (to an extension: the active tab's), its URL's or its default. */
  get<T>(key: QueryKey<T>): T;
  /** Sets `key` to `value`; one the URL holds as it holds the value now changes nothing. */
  set<T>(key: QueryKey<T>, value: T): void;
  /**
   * Fires `listener` when the value of `key` changed: set, or loaded from the tab's URL (another page, back and
   * forward), or another tab shown.
   */
  onDidChange<T>(key: QueryKey<T>, listener: () => void): Disposable;
  /** Fires when the widgets should query again: a key the data handlers read changed, or `refresh` was called. */
  readonly onDidRequestRefresh: Event<void>;
  /** Asks the widgets to query again with the same state (the refresh button, auto refresh). */
  refresh(): void;
  /**
   * What the data handlers read: the entries of each key sent to the server (`sentToServer`), in the order the keys
   * were first used (`time`, `f`, `sql`, `wp`), `time` also when it is the page's default.
   */
  requestParams(): URLSearchParams;
}

/**
 * A part of the query state with its URL format (`queryKey`): a value of `T` in each tab. The host knows a key from
 * its first use; whoever defines it owns it.
 */
export interface QueryKey<T> {
  /** The URL's keys it is kept in (`['f', 'sql']`). */
  readonly urlKeys: readonly string[];
  /** As `QueryKeySpec.parse`. */
  parse(url: URLSearchParams, page: PageJson | undefined): T;
  /** As `QueryKeySpec.format`. */
  format(value: T, page: PageJson | undefined): QueryEntries;
  /**
   * What the data handlers read of `value` (`requestParams`); none for a key not sent, whose change queries nothing
   * again (auto refresh).
   */
  request?(value: T): QueryEntries;
}

/** How a key is kept in the URL (`queryKey`), and whether the data handlers read it. */
export interface QueryKeySpec<T> {
  /**
   * The value the URL's keys hold (`url`, the tab's query string); the default for what they lack, which may be the
   * page's (`page`, the page the tab shows: its `defaultTime`; `undefined` before one is).
   */
  parse(url: URLSearchParams, page: PageJson | undefined): T;
  /** The entries of the URL that hold `value`, in order (`[['refresh', '30']]`); none for the default (`page`: as `parse`). */
  format(value: T, page: PageJson | undefined): QueryEntries;
  /**
   * Whether the data handlers read it: `true` its URL entries (`format` without a page), or a function giving other
   * entries (the time range, sent also when it is the default: the server does not know the page's). Without it the
   * key is not sent, and its change queries nothing again.
   */
  readonly sentToServer?: true | ((value: T) => QueryEntries);
}

/**
 * The key kept in the URL's keys `urlKeys` (`'refresh'`, `['time', 'range']`) as `spec` says
 * (`queryKey<AutoRefresh>('refresh', { parse, format })`); a URL key belongs to one key only.
 */
export function queryKey<T>(urlKeys: string | readonly string[], spec: QueryKeySpec<T>): QueryKey<T> {
  const { sentToServer } = spec;
  const key: QueryKey<T> = {
    urlKeys: typeof urlKeys === 'string' ? [urlKeys] : urlKeys,
    parse: (url, page) => spec.parse(url, page),
    format: (value, page) => spec.format(value, page),
  };
  if (sentToServer) key.request = sentToServer === true ? (value) => spec.format(value, undefined) : sentToServer;
  return key;
}

/** Entries of a query string, in order (`[['f', '<key>'], ['sql', 'a > 1']]`). */
export type QueryEntries = readonly (readonly [string, string])[];

export { QueryHost, QueryKeys } from './query-impl';
export { activeQuery, type ActiveQuerySource } from './active-query';
