import type * as Plot from '@observablehq/plot';
import type { QueryResult } from '../../hosts/widgets/widgets';
import { formatLocalTime } from '../time-library/format-time';

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

/**
 * A time axis's label: `alias` and the time zone its ticks are in, the viewer's (`time (local, UTC+1)`, both offsets
 * when `range` spans a change of daylight saving time: `UTC+2/+1`), or UTC for a `utc` scale (`time (UTC)`). Without
 * `range`, the offset now.
 */
export function timeAxisLabel(alias: string, range: { readonly from: number; readonly to: number } | null, scaleType: 'time' | 'utc' = 'time'): string {
  if (scaleType === 'utc') return `${alias} (UTC)`;
  const now = Date.now();
  const [from, to] = [utcOffsetOf(range?.from ?? now), utcOffsetOf(range?.to ?? now)];
  return `${alias} (local, UTC${from === to ? from : `${from}/${to}`})`;
}

/**
 * The tip of a chart with a mark per time bucket (`x`: the column of its start): the bucket first, labelled `label`
 * (`Sat 2026-10-31 20:55–21:00`, `formatTipSpan`), in place of Plot's pair of its ends in UTC (`2026-10-31T20:55Z–…`);
 * then `channels` (a chart's `tipChannels`).
 */
export function timeBucketTip(x: string, xBucketSize: number, label: string, channels?: Record<string, Plot.ChannelValueSpec>): Plot.TipOptions {
  return {
    channels: { bucket: { label, value: (d: Record<string, number>) => formatTipSpan(d[x], d[x] + xBucketSize) }, ...channels },
    format: { bucket: true, x: false },
    lineWidth: TIP_LINE_WIDTH,
  };
}

/** `Sat 2026-10-31 20:55` in the viewer's time zone, with the seconds when it has any: a time in a chart's tooltip. */
export function formatTipTime(time: Date | number): string {
  const date = new Date(time);
  return `${WEEKDAYS[date.getDay()]} ${formatLocalTime(date)}${secondsOf(date)}`;
}

/** `Sat 2026-10-31 20:55–21:00`: a time bucket in a chart's tooltip; the end's day only when it is another. */
export function formatTipSpan(from: Date | number, to: Date | number): string {
  const [fromDate, toDate] = [new Date(from), new Date(to)];
  const sameDay = fromDate.toDateString() === toDate.toDateString();
  return `${formatTipTime(fromDate)}–${sameDay ? `${formatLocalTime(toDate).slice(11)}${secondsOf(toDate)}` : formatTipTime(toDate)}`;
}

/** The width of a time chart's tip in ems: a bucket over midnight in one line (`Sat 2026-10-31 23:00–Sun 2026-11-01 00:00`). */
export const TIP_LINE_WIDTH = 32;

/** `+1`, `+5:30`, `-3`, '' for UTC itself: the viewer's offset to UTC at `time`. */
function utcOffsetOf(time: number): string {
  const minutes = -new Date(time).getTimezoneOffset();
  if (minutes === 0) return '';
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `${minutes < 0 ? '-' : '+'}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

/** `:30` for a time with seconds (a sub-minute bucket), '' for a whole minute. */
function secondsOf(date: Date): string {
  return date.getSeconds() || date.getMilliseconds() ? `:${String(date.getSeconds()).padStart(2, '0')}` : '';
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
