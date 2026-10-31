// See exploreView in explore-view.ts.
import type { ChartSql } from '../../generated/zz_generated.dashica';
import type { Diagnostics } from '../../hosts/widgets/widgets';

/** What `<rowsUrl>` answered: the rows in Arrow and what its headers said about them. */
export interface RowsAnswer {
  /** The Arrow IPC stream; `undefined` for a chart that did not run (204, `diagnostics.skipped` says why). */
  readonly arrow: ArrayBuffer | undefined;
  /** The most rows of an edited query the server sends (X-Dashica-Rows-Limit); `undefined` for the chart's result. */
  readonly limit: number | undefined;
  readonly diagnostics: Diagnostics;
}

/** A query the viewer edited: its SQL, `{name:Type}` placeholders in it, and the values they are bound to. */
export interface EditedQuery {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, string>>;
}

/**
 * The keys of `edited`: `exploreSql` and a `param_<name>` per parameter (`param___from=1761724800`), as ClickHouse's
 * HTTP interface names bound values; the rows request and the tab's hash both carry them.
 */
export function editedQueryKeys(edited: EditedQuery): [string, string][] {
  return [['exploreSql', edited.sql], ...Object.entries(edited.parameters).map(([name, value]): [string, string] => [`param_${name}`, value])];
}

/** The edited query `keys` hold (`editedQueryKeys`); `undefined` without `exploreSql`. */
export function editedQueryOf(keys: URLSearchParams): EditedQuery | undefined {
  const sql = keys.get('exploreSql');
  if (sql === null) return undefined;
  const parameters: Record<string, string> = {};
  for (const [key, value] of keys) if (key.startsWith('param_') && key.length > 'param_'.length) parameters[key.slice('param_'.length)] ??= value;
  return { sql, parameters };
}

/**
 * The URL of the rows at `rowsUrl`: the chart's result with the page's query state `params`
 * (`QueryApi.requestParams()`), or the rows of the edited query `edited` (`?exploreSql=…&param_…`), which the page's
 * state does not change.
 */
export function rowsRequest(rowsUrl: string, params: URLSearchParams, edited?: EditedQuery): string {
  const request = edited === undefined ? params : new URLSearchParams(editedQueryKeys(edited));
  return `${rowsUrl}?${request}`;
}

/** The URL of the SQL the chart at `dataUrl` runs with the page's query state `params`, and its parameters. */
export function sqlRequest(dataUrl: string, params: URLSearchParams): string {
  return `${dataUrl}/sql?${params}`;
}

/** The rows at `url` (`rowsRequest`); rejects with the server's message. */
export async function fetchRows(url: string, signal?: AbortSignal): Promise<RowsAnswer> {
  const response = await fetch(url, { signal });
  if (response.status !== 200 && response.status !== 204) throw new Error(`${response.status} ${await response.text()}`);
  const limit = response.headers.get('X-Dashica-Rows-Limit');
  return {
    arrow: response.status === 204 ? undefined : await response.arrayBuffer(),
    limit: limit ? parseInt(limit) : undefined,
    diagnostics: JSON.parse(response.headers.get('X-Dashica-Diagnostics') || '{}'),
  };
}

/**
 * The SQL and parameters at `url` (`sqlRequest`); an empty SQL for a chart that did not run (204); rejects with the
 * server's message.
 */
export async function fetchSql(url: string, signal?: AbortSignal): Promise<ChartSql> {
  const response = await fetch(url, { signal });
  if (response.status !== 200 && response.status !== 204) throw new Error(`${response.status} ${await response.text()}`);
  return response.status === 204 ? { sql: '', parameters: {} } : response.json();
}

/** What the view says about the `shown` rows: "24 rows of the chart's result", "1,234 rows", "the first 100,000 rows (limit)". */
export function describeRows(answer: Pick<RowsAnswer, 'limit'>, shown: number): string {
  const n = shown.toLocaleString('en-US');
  if (answer.limit === undefined) return `${n} rows of the chart’s result`;
  if (shown >= answer.limit) return `the first ${n} rows (limit)`;
  return `${n} rows`;
}
