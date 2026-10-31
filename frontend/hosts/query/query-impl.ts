// See QueryApi in query.ts.
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { FieldFilter, FilterOp, FiltersModel, ParamsModel, QueryApi, TimeModel } from './query';

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
   * Takes the state from `search` (`?time=1h&f=host:eq:a`), for a page about to be shown or after the browser's back
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
    this.filters.load(state.sql, state.fields);
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
    if (this.filters.sql) request.set('sql', this.filters.sql);
    for (const filter of this.filters.fields) request.append('f', formatFieldFilter(filter));
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
        sql: this.filters.sql,
        fields: this.filters.fields,
        params: this.params.values,
      };
      const search = formatSearch(state, this.#defaultTime, this.#search);
      if (search === this.#search) return;
      this.#search = search;
      this.#onDidChangeSearch.fire(search);
    }, SEARCH_WRITE_DELAY_MS);
  }
}

/** What a query string (`?time=1h&f=host:eq:a&sql=…&wp=…&refresh=30`) says about the query state. */
export interface QueryState {
  readonly range: string;
  /** The custom range; '' unless `range` is `custom`. */
  readonly custom: string;
  readonly autoRefresh: number | undefined;
  readonly sql: string;
  readonly fields: readonly FieldFilter[];
  readonly params: Readonly<Record<string, string>>;
}

/**
 * The state `search` holds; what it lacks is the default (`defaultTime` for the range). An `f` the server would refuse
 * (not `<id>:eq:<value>` or `<id>:ne:<value>`) and a `wp` that is no JSON object of strings are left out.
 */
export function parseSearch(search: string, defaultTime = DEFAULT_TIME): QueryState {
  const url = new URLSearchParams(search);
  const range = url.get('time') || defaultTime;
  const refresh = Number(url.get('refresh'));
  return {
    range,
    custom: range === 'custom' ? (url.get('range') ?? '') : '',
    autoRefresh: refresh > 0 ? refresh : undefined,
    sql: url.get('sql') ?? '',
    fields: url.getAll('f').map(parseFieldFilter).filter((filter) => filter !== undefined),
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
  if (state.sql) url.set('sql', state.sql);
  else url.delete('sql');
  url.delete('f');
  for (const filter of state.fields) url.append('f', formatFieldFilter(filter));
  if (Object.keys(state.params).length > 0) url.set('wp', JSON.stringify(state.params));
  else url.delete('wp');
  const text = url.toString();
  return text ? `?${text}` : '';
}

/** The time range of a page that declares none. */
const DEFAULT_TIME = '24h';

/** Typing into the SQL filter or a text input changes the query string once, after a pause. */
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
  sql = '';
  fields: readonly FieldFilter[] = [];

  constructor(private readonly changed: () => void) {
    super();
  }

  load(sql: string, fields: readonly FieldFilter[]): void {
    this.sql = sql;
    this.fields = fields;
  }

  setSql(sql: string): void {
    if (sql === this.sql) return;
    this.sql = sql;
    this.fire();
    this.changed();
  }

  add(condition: string): void;
  add(fieldId: string, op: FilterOp, value: string): void;
  add(conditionOrFieldId: string, op?: FilterOp, value?: string): void {
    if (op === undefined || value === undefined) {
      this.setSql(this.sql ? `${this.sql} \nAND ${conditionOrFieldId}` : conditionOrFieldId);
      return;
    }
    const added: FieldFilter = { fieldId: conditionOrFieldId, op, value };
    if (this.fields.some((filter) => filter.fieldId === added.fieldId && filter.op === op && filter.value === value)) return;
    this.#setFields([...this.fields, added]);
  }

  remove(index: number): void {
    if (index < 0 || index >= this.fields.length) return;
    this.#setFields(this.fields.filter((_, i) => i !== index));
  }

  clear(): void {
    if (this.fields.length > 0) this.#setFields([]);
  }

  #setFields(fields: readonly FieldFilter[]): void {
    this.fields = fields;
    this.fire();
    this.changed();
  }
}

/** `host:ne:a` as the server reads an `f`: the value is everything after the second colon. */
function formatFieldFilter({ fieldId, op, value }: FieldFilter): string {
  return `${fieldId}:${op}:${value}`;
}

/** The filter of an `f` (`host:ne:a`); `undefined` without an id, a second colon, or an op `eq` / `ne`. */
function parseFieldFilter(text: string): FieldFilter | undefined {
  const [fieldId, op, ...value] = text.split(':');
  if (!fieldId || (op !== 'eq' && op !== 'ne') || value.length === 0) return undefined;
  return { fieldId, op, value: value.join(':') };
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
