import type { QueryResult } from '../../hosts/widgets/widgets';

/**
 * The time range the server queried for `result` (X-Dashica-Resolved-Time-Range), in ms since the epoch: a time
 * chart's domain; `null` without the header.
 */
export function resolvedTimeRangeOf({ headers }: Pick<QueryResult, 'headers'>): { readonly from: number; readonly to: number } | null {
  return JSON.parse(headers.get('X-Dashica-Resolved-Time-Range') || 'null');
}

/** The bucket size in ms the server picked for an `AutoBucket` time axis (X-Dashica-Bucket-Size); `undefined` without. */
export function bucketSizeOf({ headers }: Pick<QueryResult, 'headers'>): number | undefined {
  const bucketSize = headers.get('X-Dashica-Bucket-Size');
  return bucketSize == null ? undefined : parseInt(bucketSize);
}
