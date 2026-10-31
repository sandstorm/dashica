// See QueryApi in query.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { QueryApi, QueryEntries, QueryState, QueryStateSpec } from './query';

/**
 * The states registered for every tab (`QueryApi.registerState`), in the order registered: the tabs' query hosts share
 * one.
 */
export class QueryStates {
  readonly #specs = new Map<string, QueryStateSpec<unknown>>();

  /** Registers `spec` as the state `id` until disposed; throws for an id or a URL key registered already. */
  register<T>(id: string, spec: QueryStateSpec<T>): Disposable {
    if (this.#specs.has(id)) throw new Error(`There is a query state ${id} already`);
    const taken = spec.keys.find((key) => [...this.#specs.values()].some((other) => other.keys.includes(key)));
    if (taken !== undefined) throw new Error(`The URL key ${taken} of the query state ${id} is another state's`);
    this.#specs.set(id, spec as QueryStateSpec<unknown>);
    return new Disposable(() => this.#specs.get(id) === spec && this.#specs.delete(id));
  }

  get(id: string): QueryStateSpec<unknown> | undefined {
    return this.#specs.get(id);
  }

  /** The states registered, by id, in the order registered. */
  entries(): [string, QueryStateSpec<unknown>][] {
    return [...this.#specs];
  }
}

/**
 * The `QueryApi` of one tab, holding the registered states' values of a query string (the tab's URL's): `load` takes
 * them from one, `onDidChangeSearch` gives the query string after a change, which the tab puts into its URL. It knows
 * no key of its own: a key no state registered stays in the query string as it is.
 */
export class QueryHost implements QueryApi {
  readonly #onDidRequestRefresh = new EventEmitter<void>();
  readonly onDidRequestRefresh = this.#onDidRequestRefresh.event;
  readonly #onDidChangeSearch = new EventEmitter<string>();
  /** Fires a moment after the last change with the query string of the state (`?time=3h`, '' for none), when it differs from the one before. */
  readonly onDidChangeSearch = this.#onDidChangeSearch.event;
  /** The page the state was loaded for, whose defaults the states take (its `defaultTime`). */
  #page: PageJson | undefined;
  #searchWrite: ReturnType<typeof setTimeout> | undefined;
  /** The query string that holds the state, as last loaded or given by `onDidChangeSearch`; its other keys stay. */
  #search = '';
  /** The registered states' values read or set here, by id; a value not read since the last load is parsed when read. */
  readonly #values = new Map<string, HeldState>();

  /** `states`: the registered states, all tabs'. */
  constructor(private readonly states = new QueryStates()) {}

  /**
   * Takes the state from `search` (`?time=1h&f=<key>`), for `page` about to be shown or after the browser's back and
   * forward; what it lacks is the default, which may be the page's (its `defaultTime`). Fires each read state's
   * `onDidChange` and one `onDidRequestRefresh`.
   */
  load({ search = '', page }: { search?: string; page?: PageJson } = {}): void {
    clearTimeout(this.#searchWrite);
    this.#page = page;
    this.#search = search;
    for (const held of this.#values.values()) held.known = false;
    for (const held of this.#values.values()) held.changed.fire();
    this.refresh();
  }

  registerState<T>(id: string, spec: QueryStateSpec<T>): QueryState<T> & { dispose(): void } {
    const registration = this.states.register(id, spec);
    return { ...this.state<T>(id)!, dispose: () => registration.dispose() };
  }

  state<T>(id: string): QueryState<T> | undefined {
    if (!this.states.get(id)) return undefined;
    let held = this.#values.get(id);
    if (!held) this.#values.set(id, (held = { value: undefined, known: false, changed: new EventEmitter<void>() }));
    const read = held;
    return {
      get: () => this.#valueOf(id, read) as T,
      set: (value) => this.#set(id, read, value),
      onDidChange: read.changed.event,
    };
  }

  refresh(): void {
    this.#onDidRequestRefresh.fire();
  }

  requestParams(): URLSearchParams {
    const request = new URLSearchParams();
    for (const [id, spec] of this.states.entries()) {
      if (spec.request) for (const [key, value] of spec.request(this.#get(id))) request.append(key, value);
    }
    return request;
  }

  dispose(): void {
    clearTimeout(this.#searchWrite);
    this.#onDidRequestRefresh.dispose();
    this.#onDidChangeSearch.dispose();
    for (const held of this.#values.values()) held.changed.dispose();
  }

  /** The value of the registered state `id`. */
  #get(id: string): unknown {
    return this.state(id)!.get();
  }

  /** `held`'s value, parsed from the query string when it was not read since the last load. */
  #valueOf(id: string, held: HeldState): unknown {
    if (!held.known) {
      held.value = this.states.get(id)!.parse(new URLSearchParams(this.#search), this.#page);
      held.known = true;
    }
    return held.value;
  }

  /** Sets the state `id` to `value`, unless the URL holds both alike; a state the handlers read asks for a refresh. */
  #set(id: string, held: HeldState, value: unknown): void {
    const spec = this.states.get(id);
    if (!spec || sameEntries(spec.format(this.#valueOf(id, held), this.#page), spec.format(value, this.#page))) return;
    held.value = value;
    held.known = true;
    held.changed.fire();
    this.#writeSearchSoon();
    if (spec.request) this.refresh();
  }

  /** The query string with each registered state's entries (`value`: its value) in place of its keys, the others kept. */
  #formatSearch(value: (id: string, spec: QueryStateSpec<unknown>) => unknown): string {
    const url = new URLSearchParams(this.#search);
    const states = this.states.entries();
    for (const [, spec] of states) for (const key of spec.keys) url.delete(key);
    for (const [id, spec] of states) for (const [key, entry] of spec.format(value(id, spec), this.#page)) url.append(key, entry);
    const text = url.toString();
    return text ? `?${text}` : '';
  }

  /** Gives the query string of the state a moment after the last change, when it changed. */
  #writeSearchSoon(): void {
    clearTimeout(this.#searchWrite);
    this.#searchWrite = setTimeout(() => {
      const search = this.#formatSearch((id) => this.#get(id));
      // as the query string before is written, so a state as loaded gives no change
      const loaded = new URLSearchParams(this.#search);
      if (search === this.#formatSearch((_, spec) => spec.parse(loaded, this.#page))) return;
      this.#search = search;
      this.#onDidChangeSearch.fire(search);
    }, SEARCH_WRITE_DELAY_MS);
  }
}

/** A registered state's value in one tab, and its change event. */
interface HeldState {
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
