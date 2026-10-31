// See QueryApi in query.ts.
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { FilterChip, FiltersModel, ParamsModel, Pill, QueryApi, TimeModel } from './query';

/**
 * The `QueryApi` of one tab, holding the state of a query string (the tab's URL's): `load` takes the state from one,
 * `onDidChangeSearch` gives the query string of the state after a change, which the tab puts into its URL. Auto
 * refresh pauses while the tab is not shown (`setShown`) or the browser tab is hidden.
 */
export class QueryHost implements QueryApi {
  readonly time: TimeState;
  readonly filters: FiltersState;
  readonly params: ParamsState;
  readonly #onDidRequestRefresh = new EventEmitter<void>();
  readonly onDidRequestRefresh = this.#onDidRequestRefresh.event;
  readonly #onDidChangeSearch = new EventEmitter<string>();
  /** Fires a moment after the last change with the query string of the state (`?time=3h`, '' for none), when it differs from the one before. */
  readonly onDidChangeSearch = this.#onDidChangeSearch.event;
  #defaultTime = DEFAULT_TIME;
  #searchWrite: ReturnType<typeof setTimeout> | undefined;
  #autoRefresh: ReturnType<typeof setInterval> | undefined;
  /**
   * An auto refresh tick came while paused; the state refreshes once when shown again, the next tick a whole interval
   * later.
   */
  #skippedTick = false;
  /** Whether its tab is shown (`setShown`). */
  #shown = true;
  /** The query string that holds the state, as last loaded or given by `onDidChangeSearch`; its other keys stay. */
  #search = '';
  readonly #onVisibilityChange = () => this.#catchUp();

  /** `browserWindow`: whose document being hidden pauses auto refresh. */
  constructor(private readonly browserWindow: Window) {
    browserWindow.document.addEventListener('visibilitychange', this.#onVisibilityChange);
    const changed = (refresh: boolean) => {
      this.#writeSearchSoon();
      if (refresh) this.refresh();
    };
    this.time = new TimeState((refresh) => {
      this.#restartAutoRefresh();
      changed(refresh);
    });
    this.filters = new FiltersState(() => changed(true));
    this.params = new ParamsState(() => changed(true));
  }

  /**
   * Takes the state from `search` (`?time=1h&f=<key>`), for a page about to be shown or after the browser's back
   * and forward; what it lacks is the default (`defaultTime`: the page's time range, else 24h). Fires every model's
   * `onDidChange` and one `onDidRequestRefresh`.
   */
  load({ search = '', defaultTime }: { search?: string; defaultTime?: string } = {}): void {
    clearTimeout(this.#searchWrite);
    this.#defaultTime = defaultTime || DEFAULT_TIME;
    const state = parseSearch(search, this.#defaultTime);
    // as `formatSearch` writes it, so an unchanged state gives no change
    this.#search = formatSearch(state, this.#defaultTime, search);
    this.time.load(state.range, state.custom, state.autoRefresh);
    this.filters.load(state.chips);
    this.params.load(state.params);
    this.#restartAutoRefresh();
    this.time.fire();
    this.filters.fire();
    this.params.fire();
    this.refresh();
  }

  /**
   * Whether its tab is shown. While not, an auto refresh tick only counts as skipped, as while the browser tab is
   * hidden; shown again after one was skipped, it refreshes once and ticks a whole interval later.
   */
  setShown(shown: boolean): void {
    if (shown === this.#shown) return;
    this.#shown = shown;
    this.#catchUp();
  }

  refresh(): void {
    this.#onDidRequestRefresh.fire();
  }

  requestParams(): URLSearchParams {
    const request = new URLSearchParams({ time: this.time.range });
    if (this.time.range === 'custom') request.set('range', this.time.custom);
    appendChips(request, this.filters.chips);
    if (Object.keys(this.params.values).length > 0) request.set('wp', JSON.stringify(this.params.values));
    return request;
  }

  dispose(): void {
    clearTimeout(this.#searchWrite);
    clearInterval(this.#autoRefresh);
    this.browserWindow.document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    this.#onDidRequestRefresh.dispose();
    this.#onDidChangeSearch.dispose();
    this.time.dispose();
    this.filters.dispose();
    this.params.dispose();
  }

  #paused(): boolean {
    return !this.#shown || this.browserWindow.document.hidden;
  }

  /** Refreshes once when a tick was skipped and it is no longer paused. */
  #catchUp(): void {
    if (this.#paused() || !this.#skippedTick) return;
    this.#restartAutoRefresh();
    this.refresh();
  }

  #restartAutoRefresh(): void {
    clearInterval(this.#autoRefresh);
    this.#skippedTick = false;
    const seconds = this.time.autoRefresh;
    if (seconds) this.#autoRefresh = setInterval(() => this.#tick(), seconds * 1000);
  }

  #tick(): void {
    if (this.#paused()) this.#skippedTick = true;
    else this.refresh();
  }

  /** Gives the query string of the state a moment after the last change, when it changed. */
  #writeSearchSoon(): void {
    clearTimeout(this.#searchWrite);
    this.#searchWrite = setTimeout(() => {
      const state: QueryState = {
        range: this.time.range,
        custom: this.time.custom,
        autoRefresh: this.time.autoRefresh,
        chips: this.filters.chips,
        params: this.params.values,
      };
      const search = formatSearch(state, this.#defaultTime, this.#search);
      if (search === this.#search) return;
      this.#search = search;
      this.#onDidChangeSearch.fire(search);
    }, SEARCH_WRITE_DELAY_MS);
  }
}

/** What a query string (`?time=1h&f=<key>&sql=…&wp=…&refresh=30`) says about the query state. */
export interface QueryState {
  readonly range: string;
  /** The custom range; '' unless `range` is `custom`. */
  readonly custom: string;
  readonly autoRefresh: number | undefined;
  /** The filter chips, in the order of their `f` and `sql`. */
  readonly chips: readonly FilterChip[];
  readonly params: Readonly<Record<string, string>>;
}

/**
 * The state `search` holds; what it lacks is the default (`defaultTime` for the range). Each `f` and `sql` is one chip,
 * in their order; an empty `f`, an `sql` of only spaces and a `wp` that is no JSON object of strings are left out. An
 * `f` is kept as it is, whatever it holds: the server checks its signature.
 */
export function parseSearch(search: string, defaultTime = DEFAULT_TIME): QueryState {
  const url = new URLSearchParams(search);
  const range = url.get('time') || defaultTime;
  const refresh = Number(url.get('refresh'));
  return {
    range,
    custom: range === 'custom' ? (url.get('range') ?? '') : '',
    autoRefresh: refresh > 0 ? refresh : undefined,
    chips: [...url].map(([key, value]) => parseChip(key, value)).filter((chip) => chip !== undefined),
    params: parseParams(url.get('wp')),
  };
}

/**
 * The query string of `state` (`?time=3h&refresh=30`, '' for none), its other keys taken from `search`; what is the
 * default (`defaultTime`, no filter) is left out.
 */
export function formatSearch(state: QueryState, defaultTime: string, search = ''): string {
  const url = new URLSearchParams(search);
  if (state.range !== defaultTime) url.set('time', state.range);
  else url.delete('time');
  if (state.range === 'custom' && state.custom) url.set('range', state.custom);
  else url.delete('range');
  if (state.autoRefresh) url.set('refresh', String(state.autoRefresh));
  else url.delete('refresh');
  url.delete('sql');
  url.delete('f');
  appendChips(url, state.chips);
  if (Object.keys(state.params).length > 0) url.set('wp', JSON.stringify(state.params));
  else url.delete('wp');
  const text = url.toString();
  return text ? `?${text}` : '';
}

/** The time range of a page that declares none. */
const DEFAULT_TIME = '24h';

/** Typing into a text input changes the query string once, after a pause. */
const SEARCH_WRITE_DELAY_MS = 200;

class Model extends EventEmitter<void> {
  readonly onDidChange = this.event;
}

class TimeState extends Model implements TimeModel {
  range = DEFAULT_TIME;
  custom = '';
  autoRefresh: number | undefined;

  /** `changed(true)`: the queries depend on the change. */
  constructor(private readonly changed: (refresh: boolean) => void) {
    super();
  }

  load(range: string, custom: string, autoRefresh: number | undefined): void {
    this.range = range;
    this.custom = range === 'custom' ? custom : '';
    this.autoRefresh = autoRefresh;
  }

  setRange(range: string): void {
    if (range === this.range) return;
    this.range = range;
    if (range !== 'custom') this.custom = '';
    this.fire();
    this.changed(true);
  }

  setCustom(from: string, to: string): void {
    this.range = 'custom';
    this.custom = `${from} to ${to}`;
    this.fire();
    this.changed(true);
  }

  setAutoRefresh(seconds: number | undefined): void {
    if (seconds === this.autoRefresh) return;
    this.autoRefresh = seconds;
    this.fire();
    this.changed(false);
  }
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
      typeof conditionOrPill === 'string' ? { kind: 'sql', sql: conditionOrPill } : { kind: 'pill', key: conditionOrPill.key, label: conditionOrPill.label };
    if (isEmpty(added) || this.chips.some((chip) => sameChip(chip, added))) return;
    this.#setChips([...this.chips, added]);
  }

  replace(index: number, chip: FilterChip): void {
    if (index < 0 || index >= this.chips.length || sameChip(this.chips[index], chip)) return;
    this.#setChips(isEmpty(chip) ? this.chips.filter((_, i) => i !== index) : this.chips.map((old, i) => (i === index ? chip : old)));
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
  if (key === 'f' && value !== '') return { kind: 'pill', key: value, label: pillLabel(value) };
  if (key === 'sql' && value.trim() !== '') return { kind: 'sql', sql: value };
  return undefined;
}

/**
 * The label a pill's key carries (`customer = acme`): its key is `<payload>.<mac>`, the payload the pill as JSON in
 * base64url (lib/dashboard/filter, `Sign`); the key itself when it has none.
 */
export function pillLabel(key: string): string {
  const dot = key.indexOf('.');
  if (dot < 0) return key;
  try {
    const payload = key.slice(0, dot).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const { label } = JSON.parse(new TextDecoder().decode(bytes)) as { label?: unknown };
    if (typeof label === 'string' && label) return label;
  } catch {
    // not a pill's key: the server refuses it, the chip shows it as it is
  }
  return key;
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

/** `2026-10-29 10:00` in the viewer's time zone: an end of a custom range, as `TimeModel.setCustom` takes it. */
export function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
