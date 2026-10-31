// See QueryApi in query.ts.
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { Disposable } from '../../core/disposable/disposable';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { FilterChip, FiltersModel, ParamsModel, Pill, QueryApi, QueryEntries, QueryState, QueryStateSpec } from './query';

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
 * The `QueryApi` of one tab, holding the state of a query string (the tab's URL's): `load` takes the state from one,
 * `onDidChangeSearch` gives the query string of the state after a change, which the tab puts into its URL.
 */
export class QueryHost implements QueryApi {
  readonly filters: FiltersState;
  readonly params: ParamsState;
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
  /** The registered states' values read or set here, by id; a state not read since the last load is not in it. */
  readonly #values = new Map<string, HeldState>();

  /** `states`: the registered states, all tabs'. */
  constructor(private readonly states = new QueryStates()) {
    const changed = () => {
      this.#writeSearchSoon();
      this.refresh();
    };
    this.filters = new FiltersState(changed);
    this.params = new ParamsState(changed);
  }

  /**
   * Takes the state from `search` (`?time=1h&f=<key>`), for `page` about to be shown or after the browser's back and
   * forward; what it lacks is the default, which may be the page's (its `defaultTime`). Fires every model's and read
   * state's `onDidChange` and one `onDidRequestRefresh`.
   */
  load({ search = '', page }: { search?: string; page?: PageJson } = {}): void {
    clearTimeout(this.#searchWrite);
    this.#page = page;
    const state = parseSearch(search);
    this.#search = search;
    this.filters.load(state.chips);
    this.params.load(state.params);
    for (const held of this.#values.values()) held.known = false;
    this.filters.fire();
    this.params.fire();
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
    appendChips(request, this.filters.chips);
    if (Object.keys(this.params.values).length > 0) request.set('wp', JSON.stringify(this.params.values));
    return request;
  }

  dispose(): void {
    clearTimeout(this.#searchWrite);
    this.#onDidRequestRefresh.dispose();
    this.#onDidChangeSearch.dispose();
    for (const held of this.#values.values()) held.changed.dispose();
    this.filters.dispose();
    this.params.dispose();
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

  /** The query string `formatSearch` writes, then each registered state's entries (`value`: its value) in place of its keys. */
  #formatSearch(state: SearchState, value: (id: string) => unknown): string {
    const url = new URLSearchParams(formatSearch(state, this.#search));
    const states = this.states.entries();
    for (const [, spec] of states) for (const key of spec.keys) url.delete(key);
    for (const [id, spec] of states) for (const [key, entry] of spec.format(value(id), this.#page)) url.append(key, entry);
    const text = url.toString();
    return text ? `?${text}` : '';
  }

  /** Gives the query string of the state a moment after the last change, when it changed. */
  #writeSearchSoon(): void {
    clearTimeout(this.#searchWrite);
    this.#searchWrite = setTimeout(() => {
      const state: SearchState = {
        chips: this.filters.chips,
        params: this.params.values,
      };
      const search = this.#formatSearch(state, (id) => this.#get(id));
      // as the query string before is written, so a state as loaded gives no change
      const loaded = new URLSearchParams(this.#search);
      if (search === this.#formatSearch(parseSearch(this.#search), (id) => this.states.get(id)!.parse(loaded, this.#page))) return;
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

/** What a query string (`?f=<key>&sql=…&wp=…`) says about the filters and the params. */
export interface SearchState {
  /** The filter chips, in the order of their `f` and `sql`. */
  readonly chips: readonly FilterChip[];
  readonly params: Readonly<Record<string, string>>;
}

/**
 * The filters and params `search` holds. Each `f` and `sql` is one chip, in their order; an empty `f`, an `sql` of only
 * spaces and a `wp` that is no JSON object of strings are left out. An `f` is kept as it is, whatever it holds: the
 * server checks its signature.
 */
export function parseSearch(search: string): SearchState {
  const url = new URLSearchParams(search);
  return {
    chips: [...url].map(([key, value]) => parseChip(key, value)).filter((chip) => chip !== undefined),
    params: parseParams(url.get('wp')),
  };
}

/**
 * The query string of `state` (`?sql=a&wp=…`, '' for none), its other keys taken from `search`; what is the default
 * (no filter, no param) is left out.
 */
export function formatSearch(state: SearchState, search = ''): string {
  const url = new URLSearchParams(search);
  url.delete('sql');
  url.delete('f');
  appendChips(url, state.chips);
  if (Object.keys(state.params).length > 0) url.set('wp', JSON.stringify(state.params));
  else url.delete('wp');
  const text = url.toString();
  return text ? `?${text}` : '';
}

/** Typing into a text input changes the query string once, after a pause. */
const SEARCH_WRITE_DELAY_MS = 200;

class Model extends EventEmitter<void> {
  readonly onDidChange = this.event;
}

class FiltersState extends Model implements FiltersModel {
  chips: readonly FilterChip[] = [];

  constructor(private readonly changed: () => void) {
    super();
  }

  load(chips: readonly FilterChip[]): void {
    this.chips = chips;
  }

  add(condition: string): void;
  add(pill: Pill): void;
  add(conditionOrPill: string | Pill): void {
    const added: FilterChip =
      typeof conditionOrPill === 'string' ? { kind: 'sql', sql: conditionOrPill } : { kind: 'pill', key: conditionOrPill.key };
    if (isEmpty(added) || this.chips.some((chip) => sameChip(chip, added))) return;
    this.#setChips([...this.chips, added]);
  }

  replace(index: number, chip: FilterChip): void {
    if (index < 0 || index >= this.chips.length || sameChip(this.chips[index], chip)) return;
    // an edit that makes a chip another one already is (`host = a` switched to the `host ≠ a` beside it) removes it
    const removed = isEmpty(chip) || this.chips.some((old) => sameChip(old, chip));
    this.#setChips(removed ? this.chips.filter((_, i) => i !== index) : this.chips.map((old, i) => (i === index ? chip : old)));
  }

  remove(which: number | ((chip: FilterChip) => boolean)): void {
    const kept = this.chips.filter((chip, i) => (typeof which === 'number' ? i !== which : !which(chip)));
    if (kept.length < this.chips.length) this.#setChips(kept);
  }

  clear(): void {
    if (this.chips.length > 0) this.#setChips([]);
  }

  #setChips(chips: readonly FilterChip[]): void {
    this.chips = chips;
    this.fire();
    this.changed();
  }
}

function sameChip(a: FilterChip, b: FilterChip): boolean {
  if (a.kind === 'sql') return b.kind === 'sql' && a.sql === b.sql;
  return b.kind === 'pill' && a.key === b.key;
}

/** A SQL chip of only spaces: it filters nothing, the server leaves it out. */
function isEmpty(chip: FilterChip): boolean {
  return chip.kind === 'sql' && chip.sql.trim() === '';
}

/** Appends each of `chips` to `url` in order, an `f` or an `sql`. */
function appendChips(url: URLSearchParams, chips: readonly FilterChip[]): void {
  for (const chip of chips) {
    if (chip.kind === 'sql') url.append('sql', chip.sql);
    else url.append('f', chip.key);
  }
}

/** The chip of the URL's entry `key`=`value`; `undefined` for another key, an empty `f`, an `sql` of only spaces. */
function parseChip(key: string, value: string): FilterChip | undefined {
  if (key === 'f' && value !== '') return { kind: 'pill', key: value };
  if (key === 'sql' && value.trim() !== '') return { kind: 'sql', sql: value };
  return undefined;
}

class ParamsState extends Model implements ParamsModel {
  values: Readonly<Record<string, string>> = {};

  constructor(private readonly changed: () => void) {
    super();
  }

  load(values: Readonly<Record<string, string>>): void {
    this.values = values;
  }

  get(name: string): string | undefined {
    return this.values[name];
  }

  set(name: string, value: string): void {
    if (this.values[name] === value) return;
    this.values = { ...this.values, [name]: value };
    this.fire();
    this.changed();
  }
}

/** The params of the URL's `wp`: a JSON object of strings; anything else is none. */
function parseParams(text: string | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(text ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

