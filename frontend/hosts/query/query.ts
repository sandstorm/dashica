import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { PageJson } from '../../generated/zz_generated.dashica';

/**
 * The state every query of a tab's page depends on, kept in the tab's URL: each tab has its own, so a link opens the
 * page as it was shared, and the browser's back button goes to the state before. The host knows no key of its own;
 * each part of the state is a typed key that carries its URL format (`queryKey`), defined once by the extension or
 * library it belongs to and imported by its readers. The extension that owns a key declares it in its `activate`
 * (`declare`), so every key is known before the first page; using a key no extension declared throws. Widgets query
 * again on `onDidRequestRefresh` and send `requestParams()` along; extensions get the active tab's (`activeQuery`).
 */
export interface QueryApi {
  /**
   * Makes `key` part of every tab's state: from now on it is read from and written to the URL and, when
   * `sentToServer`, sent; disposing takes it out again. Its owner calls it in `activate`
   * (`subscriptions.push(query.declare(TIME))`), a reader never does. Throws for a URL key a declared key holds.
   */
  declare<T>(key: QueryKey<T>): Disposable;
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
   * What the data handlers read: the effective value of each key sent to the server (`sentToServer`), in the order
   * the keys were declared, each as `format` gives it without a page: a default included (the page's time range).
   */
  requestParams(): URLSearchParams;
}

/**
 * A part of the query state with its URL format (`queryKey`): a value of `T` in each tab. Whoever defines it owns it
 * and declares it (`QueryApi.declare`).
 */
export interface QueryKey<T> {
  /** The URL's keys it is kept in (`['f', 'sql']`). */
  readonly urlKeys: readonly string[];
  /** As `QueryKeySpec.parse`. */
  parse(url: URLSearchParams, page: PageJson | undefined): T;
  /** As `QueryKeySpec.format`. */
  format(value: T, page: PageJson | undefined): QueryEntries;
  /** As `QueryKeySpec.sentToServer`. */
  readonly sentToServer: boolean;
}

/** How a key is kept in the URL (`queryKey`), and whether the data handlers read it. */
export interface QueryKeySpec<T> {
  /**
   * The value the URL's keys hold (`url`, the tab's query string); the default for what they lack, which may be the
   * page's (`page`, the page the tab shows: its `defaultTime`; `undefined` before one is).
   */
  parse(url: URLSearchParams, page: PageJson | undefined): T;
  /**
   * The entries that hold `value`, in order (`[['refresh', '30']]`): for the URL none for the default of `page` (the
   * page the tab shows); without a page, the request's (`requestParams`), the default included.
   */
  format(value: T, page: PageJson | undefined): QueryEntries;
  /**
   * Whether the data handlers read it: sent, it sends its effective value (`format` without a page). Without it the
   * key is not sent, and its change queries nothing again (auto refresh).
   */
  readonly sentToServer?: boolean;
}

/**
 * The key kept in the URL's keys `urlKeys` (`'refresh'`, `['time', 'range']`) as `spec` says
 * (`queryKey<AutoRefresh>('refresh', { parse, format })`); a URL key belongs to one declared key only.
 */
export function queryKey<T>(urlKeys: string | readonly string[], spec: QueryKeySpec<T>): QueryKey<T> {
  return {
    urlKeys: typeof urlKeys === 'string' ? [urlKeys] : urlKeys,
    parse: (url, page) => spec.parse(url, page),
    format: (value, page) => spec.format(value, page),
    sentToServer: spec.sentToServer ?? false,
  };
}

/** Entries of a query string, in order (`[['f', '<key>'], ['sql', 'a > 1']]`). */
export type QueryEntries = readonly (readonly [string, string])[];

export { QueryHost, QueryKeys } from './query-impl';
export { activeQuery, type ActiveQuerySource } from './active-query';
