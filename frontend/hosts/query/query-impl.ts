// See QueryApi in query.ts.
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { FiltersModel, ParamsModel, QueryApi, TimeModel, ViewOptionsModel } from './query';

/** The workbench's `QueryApi`, kept in the URL of `browserWindow`. `load` takes the state from the URL. */
export class QueryHost implements QueryApi {
  readonly time: TimeState;
  readonly filters: FiltersState;
  readonly params: ParamsState;
  readonly viewOptions: ViewOptionsState;
  readonly #onDidRequestRefresh = new EventEmitter<void>();
  readonly onDidRequestRefresh = this.#onDidRequestRefresh.event;
  #defaultTime = DEFAULT_TIME;
  #urlWrite: ReturnType<typeof setTimeout> | undefined;
  #autoRefresh: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly browserWindow: Window) {
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
    this.viewOptions = new ViewOptionsState(() => changed(false));
  }

  /**
   * Takes the state from the URL, for a page about to be shown or after the browser's back and forward; what the URL
   * lacks is the default (`defaultTime`: the page's time range, else 24h). Fires every model's `onDidChange` and one
   * `onDidRequestRefresh`.
   */
  load({ defaultTime }: { defaultTime?: string } = {}): void {
    clearTimeout(this.#urlWrite);
    this.#defaultTime = defaultTime || DEFAULT_TIME;
    const url = new URLSearchParams(this.browserWindow.location.search);
    const refresh = Number(url.get('refresh'));
    this.time.load(url.get('time') || this.#defaultTime, url.get('range') ?? '', refresh > 0 ? refresh : undefined);
    this.filters.load(url.get('sql') ?? '');
    this.params.load(parseParams(url.get('wp')));
    this.viewOptions.load(url.get('log') === '1');
    this.#restartAutoRefresh();
    for (const model of [this.time, this.filters, this.params, this.viewOptions]) model.fire();
    this.refresh();
  }

  refresh(): void {
    this.#onDidRequestRefresh.fire();
  }

  requestParams(): URLSearchParams {
    const request = new URLSearchParams();
    request.set('filters', JSON.stringify({ timeRange: this.time.range, customTimeRange: this.time.custom, sqlFilter: this.filters.sql }));
    if (Object.keys(this.params.values).length > 0) request.set('params', JSON.stringify(this.params.values));
    return request;
  }

  dispose(): void {
    clearTimeout(this.#urlWrite);
    clearInterval(this.#autoRefresh);
    for (const emitter of [this.#onDidRequestRefresh, this.time, this.filters, this.params, this.viewOptions]) emitter.dispose();
  }

  #restartAutoRefresh(): void {
    clearInterval(this.#autoRefresh);
    const seconds = this.time.autoRefresh;
    if (seconds) this.#autoRefresh = setInterval(() => this.refresh(), seconds * 1000);
  }

  /** Writes the state into the URL a moment after the last change, as a new history entry when it changed. */
  #writeUrlSoon(): void {
    clearTimeout(this.#urlWrite);
    this.#urlWrite = setTimeout(() => {
      const { location, history } = this.browserWindow;
      const url = new URLSearchParams(location.search);
      const set = (key: string, value: string | undefined) => (value ? url.set(key, value) : url.delete(key));
      set('time', this.time.range === this.#defaultTime ? undefined : this.time.range);
      set('range', this.time.range === 'custom' ? this.time.custom : undefined);
      set('refresh', this.time.autoRefresh?.toString());
      set('log', this.viewOptions.logScale ? '1' : undefined);
      set('sql', this.filters.sql);
      set('wp', Object.keys(this.params.values).length > 0 ? JSON.stringify(this.params.values) : undefined);
      const search = url.toString();
      if (search !== location.search.replace(/^\?/, '')) history.pushState(history.state, '', search ? `?${search}` : location.pathname);
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

  setCustom(from: Date, to: Date): void {
    this.range = 'custom';
    this.custom = `${formatLocal(from)} to ${formatLocal(to)}`;
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

  constructor(private readonly changed: () => void) {
    super();
  }

  load(sql: string): void {
    this.sql = sql;
  }

  setSql(sql: string): void {
    if (sql === this.sql) return;
    this.sql = sql;
    this.fire();
    this.changed();
  }

  add(condition: string): void {
    this.setSql(this.sql ? `${this.sql} \nAND ${condition}` : condition);
  }
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

class ViewOptionsState extends Model implements ViewOptionsModel {
  logScale = false;

  constructor(private readonly changed: () => void) {
    super();
  }

  load(logScale: boolean): void {
    this.logScale = logScale;
  }

  setLogScale(logScale: boolean): void {
    if (logScale === this.logScale) return;
    this.logScale = logScale;
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

/** `2026-10-29 10:00` in the viewer's time zone. */
function formatLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
