// See QueryApi in query.ts.
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { FieldFilter, FilterOp, FiltersModel, ParamsModel, QueryApi, TimeModel } from './query';

/** The workbench's `QueryApi`, kept in the URL of `browserWindow`. `load` takes the state from the URL. */
export class QueryHost implements QueryApi {
  readonly time: TimeState;
  readonly filters: FiltersState;
  readonly params: ParamsState;
  readonly #onDidRequestRefresh = new EventEmitter<void>();
  readonly onDidRequestRefresh = this.#onDidRequestRefresh.event;
  #defaultTime = DEFAULT_TIME;
  #urlWrite: ReturnType<typeof setTimeout> | undefined;
  #autoRefresh: ReturnType<typeof setInterval> | undefined;
  /**
   * An auto refresh tick came while the tab was hidden; the tab refreshes once when it is shown again, the next tick a
   * whole interval later.
   */
  #skippedTick = false;
  /** The search of the URL that holds the state (`?time=1h`, '' for none), as last loaded or written. */
  #search = '';
  readonly #onVisibilityChange = () => {
    if (this.browserWindow.document.hidden || !this.#skippedTick) return;
    this.#restartAutoRefresh();
    this.refresh();
  };

  constructor(private readonly browserWindow: Window) {
    browserWindow.document.addEventListener('visibilitychange', this.#onVisibilityChange);
    const changed = (refresh: boolean) => {
      this.#writeUrlSoon();
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
   * Takes the state from the URL, for a page about to be shown or after the browser's back and forward; what the URL
   * lacks is the default (`defaultTime`: the page's time range, else 24h). Fires every model's `onDidChange` and one
   * `onDidRequestRefresh`.
   */
  load({ defaultTime }: { defaultTime?: string } = {}): void {
    clearTimeout(this.#urlWrite);
    this.#defaultTime = defaultTime || DEFAULT_TIME;
    this.#search = this.browserWindow.location.search;
    const url = new URLSearchParams(this.#search);
    const refresh = Number(url.get('refresh'));
    this.time.load(url.get('time') || this.#defaultTime, url.get('range') ?? '', refresh > 0 ? refresh : undefined);
    this.filters.load(url.get('sql') ?? '', url.getAll('f'));
    this.params.load(parseParams(url.get('wp')));
    this.#restartAutoRefresh();
    this.time.fire();
    this.filters.fire();
    this.params.fire();
    this.refresh();
  }

  /** Whether the URL of the browser holds the state as it is: only its hash changed since. */
  holdsState(): boolean {
    return this.browserWindow.location.search === this.#search;
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
    clearTimeout(this.#urlWrite);
    clearInterval(this.#autoRefresh);
    this.browserWindow.document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    this.#onDidRequestRefresh.dispose();
    this.time.dispose();
    this.filters.dispose();
    this.params.dispose();
  }

  #restartAutoRefresh(): void {
    clearInterval(this.#autoRefresh);
    this.#skippedTick = false;
    const seconds = this.time.autoRefresh;
    if (seconds) this.#autoRefresh = setInterval(() => this.#tick(), seconds * 1000);
  }

  #tick(): void {
    if (this.browserWindow.document.hidden) this.#skippedTick = true;
    else this.refresh();
  }

  /** Writes the state into the URL a moment after the last change, as a new history entry when it changed. */
  #writeUrlSoon(): void {
    clearTimeout(this.#urlWrite);
    this.#urlWrite = setTimeout(() => {
      const { location, history } = this.browserWindow;
      const url = new URLSearchParams(location.search);
      if (this.time.range !== this.#defaultTime) url.set('time', this.time.range);
      else url.delete('time');
      if (this.time.range === 'custom' && this.time.custom) url.set('range', this.time.custom);
      else url.delete('range');
      if (this.time.autoRefresh) url.set('refresh', String(this.time.autoRefresh));
      else url.delete('refresh');
      if (this.filters.sql) url.set('sql', this.filters.sql);
      else url.delete('sql');
      url.delete('f');
      for (const filter of this.filters.fields) url.append('f', formatFieldFilter(filter));
      if (Object.keys(this.params.values).length > 0) url.set('wp', JSON.stringify(this.params.values));
      else url.delete('wp');
      const search = url.toString();
      if (search !== location.search.replace(/^\?/, '')) history.pushState(history.state, '', search ? `?${search}` : location.pathname);
      this.#search = location.search;
    }, URL_WRITE_DELAY_MS);
  }
}

/** The time range of a page that declares none. */
const DEFAULT_TIME = '24h';

/** Typing into the SQL filter or a text input writes the URL once, after a pause. */
const URL_WRITE_DELAY_MS = 200;

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

  /** `fields`: the URL's `f` values (`host:ne:a`); one the server would refuse (not `<id>:eq:<value>` or `<id>:ne:<value>`) is left out. */
  load(sql: string, fields: readonly string[]): void {
    this.sql = sql;
    this.fields = fields.map(parseFieldFilter).filter((filter) => filter !== undefined);
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

  load(values: Record<string, string>): void {
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
