// See exploreView in explore-view.ts.
import type { Diagnostics } from '../../hosts/widgets/widgets';

/** What `<rowsUrl>` answered: the rows in Arrow and what its headers said about them. */
export interface RowsAnswer {
  /** The Arrow IPC stream; `undefined` for a chart that did not run (204, `diagnostics.skipped` says why). */
  readonly arrow: ArrayBuffer | undefined;
  /** The chart's grouping can be removed: its rows without grouping are served (X-Dashica-Grouping: removable). */
  readonly groupingRemovable: boolean;
  /** The most rows without grouping the server sends, the newest (X-Dashica-Rows-Limit); `undefined` for the chart's result. */
  readonly limit: number | undefined;
  readonly diagnostics: Diagnostics;
}

/**
 * The URL of the rows at `rowsUrl` with the page's query state `params` (`QueryApi.requestParams()`): the chart's
 * result, or with `ungrouped` its rows without grouping.
 */
export function rowsRequest(rowsUrl: string, params: URLSearchParams, ungrouped = false): string {
  const request = new URLSearchParams(params);
  if (ungrouped) request.set('grouping', 'none');
  return `${rowsUrl}?${request}`;
}

/** The rows at `url` (`rowsRequest`); rejects with the server's message. */
export async function fetchRows(url: string, signal?: AbortSignal): Promise<RowsAnswer> {
  const response = await fetch(url, { signal });
  if (response.status !== 200 && response.status !== 204) throw new Error(`${response.status} ${await response.text()}`);
  const limit = response.headers.get('X-Dashica-Rows-Limit');
  return {
    arrow: response.status === 204 ? undefined : await response.arrayBuffer(),
    groupingRemovable: response.headers.get('X-Dashica-Grouping') === 'removable',
    limit: limit ? parseInt(limit) : undefined,
    diagnostics: JSON.parse(response.headers.get('X-Dashica-Diagnostics') || '{}'),
  };
}

/** What the view says about the `shown` rows: "24 rows of the chart's result", "1,234 rows", "the newest 100,000 rows (limit)". */
export function describeRows(answer: Pick<RowsAnswer, 'limit'>, shown: number): string {
  const n = shown.toLocaleString('en-US');
  if (answer.limit === undefined) return `${n} rows of the chart’s result`;
  if (shown >= answer.limit) return `the newest ${n} rows (limit)`;
  return `${n} rows`;
}
