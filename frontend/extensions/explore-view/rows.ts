// See exploreView in explore-view.ts.
import type { Diagnostics } from '../../hosts/widgets/widgets';

/** What `<rowsUrl>` answered: the rows in Arrow and what its headers said about them. */
export interface RowsAnswer {
  /** The Arrow IPC stream; `undefined` for a chart that did not run (204, `diagnostics.skipped` says why). */
  readonly arrow: ArrayBuffer | undefined;
  /** The chart's SQL can be edited and run in the view: Explore is enabled (X-Dashica-Sql: editable). */
  readonly sqlEditable: boolean;
  /** The most rows of an edited query the server sends (X-Dashica-Rows-Limit); `undefined` for the chart's result. */
  readonly limit: number | undefined;
  readonly diagnostics: Diagnostics;
}

/**
 * The URL of the rows at `rowsUrl`: the chart's result with the page's query state `params`
 * (`QueryApi.requestParams()`), or the rows of the edited SQL `edited` (`?xsql=`), which the page's state does not
 * change.
 */
export function rowsRequest(rowsUrl: string, params: URLSearchParams, edited?: string): string {
  const request = edited === undefined ? params : new URLSearchParams({ xsql: edited });
  return `${rowsUrl}?${request}`;
}

/** The URL of the SQL the chart at `dataUrl` runs with the page's query state `params`, its parameters written in. */
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
    sqlEditable: response.headers.get('X-Dashica-Sql') === 'editable',
    limit: limit ? parseInt(limit) : undefined,
    diagnostics: JSON.parse(response.headers.get('X-Dashica-Diagnostics') || '{}'),
  };
}

/** The SQL at `url` (`sqlRequest`); '' for a chart that did not run (204); rejects with the server's message. */
export async function fetchSql(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (response.status !== 200 && response.status !== 204) throw new Error(`${response.status} ${await response.text()}`);
  return response.status === 204 ? '' : response.text();
}

/** What the view says about the `shown` rows: "24 rows of the chart's result", "1,234 rows", "the first 100,000 rows (limit)". */
export function describeRows(answer: Pick<RowsAnswer, 'limit'>, shown: number): string {
  const n = shown.toLocaleString('en-US');
  if (answer.limit === undefined) return `${n} rows of the chart’s result`;
  if (shown >= answer.limit) return `the first ${n} rows (limit)`;
  return `${n} rows`;
}
