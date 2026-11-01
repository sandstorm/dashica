// See QueryApi in query.ts.
import type { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { QueryApi, QueryEntries, QueryKey } from './query';

/**
 * The keys used so far in any tab, in the order first used: the tabs' query hosts share one, so each tab writes and
 * sends every key, also one it never read itself.
 */
export class QueryKeys {
  readonly #keys: QueryKey<unknown>[] = [];

  /** Knows `key` from now on; throws for a URL key another key holds. */
  use(key: QueryKey<unknown>): void {
    if (this.#keys.includes(key)) return;
    const taken = key.urlKeys.find((urlKey) => this.#keys.some((other) => other.urlKeys.includes(urlKey)));
    if (taken !== undefined) throw new Error(`The URL key ${taken} belongs to another query key`);
    this.#keys.push(key);
  }

  /** The keys used, in the order first used. */
  all(): readonly QueryKey<unknown>[] {
    return this.#keys;
  }
}

/**
 * The `QueryApi` of one tab, holding the keys' values of a query string (the tab's URL's): `load` takes them from one,
 * `onDidChangeSearch` gives the query string after a change, which the tab puts into its URL. It knows no key of its
 * own: a URL key no query key holds stays in the query string as it is.
 */
export class QueryHost implements QueryApi {
  readonly #onDidRequestRefresh = new EventEmitter<void>();
  readonly onDidRequestRefresh = this.#onDidRequestRefresh.event;
  readonly #onDidChangeSearch = new EventEmitter<string>();
  /** Fires a moment after the last change with the query string of the state (`?time=3h`, '' for none), when it differs from the one before. */
  readonly onDidChangeSearch = this.#onDidChangeSearch.event;
  /** The page the state was loaded for, whose defaults the keys take (its `defaultTime`). */
  #page: PageJson | undefined;
  #searchWrite: ReturnType<typeof setTimeout> | undefined;
  /** The query string that holds the state, as last loaded or given by `onDidChangeSearch`; its other keys stay. */
  #search = '';
  /** The keys' values read or set here; a value not read since the last load is parsed when read. */
  readonly #values = new Map<QueryKey<unknown>, HeldValue>();

  /** `keys`: the keys used, all tabs'. */
  constructor(private readonly keys = new QueryKeys()) {}

  /**
   * Takes the state from `search` (`?time=1h&f=<key>`), for `page` about to be shown or after the browser's back and
   * forward; what it lacks is the default, which may be the page's (its `defaultTime`). Fires each read key's change
   * and one `onDidRequestRefresh`.
   */
  load({ search = '', page }: { search?: string; page?: PageJson } = {}): void {
    clearTimeout(this.#searchWrite);
    this.#page = page;
    this.#search = search;
    for (const held of this.#values.values()) held.known = false;
    for (const held of this.#values.values()) held.changed.fire();
    this.refresh();
  }

  get<T>(key: QueryKey<T>): T {
    const held = this.#held(key);
    if (!held.known) {
      held.value = key.parse(new URLSearchParams(this.#search), this.#page);
      held.known = true;
    }
    return held.value as T;
  }

  /** Sets `key` to `value`, unless the URL holds both alike; a key the handlers read asks for a refresh. */
  set<T>(key: QueryKey<T>, value: T): void {
    if (sameEntries(key.format(this.get(key), this.#page), key.format(value, this.#page))) return;
    const held = this.#held(key);
    held.value = value;
    held.known = true;
    held.changed.fire();
    this.#writeSearchSoon();
    if (key.sentToServer) this.refresh();
  }

  onDidChange<T>(key: QueryKey<T>, listener: () => void): Disposable {
    return this.#held(key).changed.event(listener);
  }

  refresh(): void {
    this.#onDidRequestRefresh.fire();
  }

  requestParams(): URLSearchParams {
    const request = new URLSearchParams();
    for (const key of this.keys.all()) {
      if (key.sentToServer) for (const [name, value] of key.format(this.get(key), this.#page)) request.append(name, value);
    }
    return request;
  }

  dispose(): void {
    clearTimeout(this.#searchWrite);
    this.#onDidRequestRefresh.dispose();
    this.#onDidChangeSearch.dispose();
    for (const held of this.#values.values()) held.changed.dispose();
  }

  /** The value held for `key` here, known to every tab from its first use. */
  #held(key: QueryKey<unknown>): HeldValue {
    let held = this.#values.get(key);
    if (!held) {
      this.keys.use(key);
      this.#values.set(key, (held = { value: undefined, known: false, changed: new EventEmitter<void>() }));
    }
    return held;
  }

  /** The query string with each key's entries (`value`: its value) in place of its URL keys, the others kept. */
  #formatSearch(value: (key: QueryKey<unknown>) => unknown): string {
    const url = new URLSearchParams(this.#search);
    const keys = this.keys.all();
    for (const key of keys) for (const urlKey of key.urlKeys) url.delete(urlKey);
    for (const key of keys) for (const [name, entry] of key.format(value(key), this.#page)) url.append(name, entry);
    const text = url.toString();
    return text ? `?${text}` : '';
  }

  /** Gives the query string of the state a moment after the last change, when it changed. */
  #writeSearchSoon(): void {
    clearTimeout(this.#searchWrite);
    this.#searchWrite = setTimeout(() => {
      const search = this.#formatSearch((key) => this.get(key));
      // as the query string before is written, so a state as loaded gives no change
      const loaded = new URLSearchParams(this.#search);
      if (search === this.#formatSearch((key) => key.parse(loaded, this.#page))) return;
      this.#search = search;
      this.#onDidChangeSearch.fire(search);
    }, SEARCH_WRITE_DELAY_MS);
  }
}

/** A key's value in one tab, and its change event. */
interface HeldValue {
  value: unknown;
  /** Whether `value` is the one of the query string or set since: false until read after a load. */
  known: boolean;
  readonly changed: EventEmitter<void>;
}

/** Whether `a` and `b` are the same entries in the same order. */
function sameEntries(a: QueryEntries, b: QueryEntries): boolean {
  return a.length === b.length && a.every(([key, value], i) => key === b[i][0] && value === b[i][1]);
}

/** Typing into a text input changes the query string once, after a pause. */
const SEARCH_WRITE_DELAY_MS = 200;
