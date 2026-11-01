import { queryKey } from '../../hosts/query/query';

/**
 * The time range of a tab's query state (`query.get(TIME)`), shown and set by the `time-range` extension, set by a
 * selection on a time chart (`customRange`). In the URL, `?time=1h`, `?time=custom&range=now-6h to now-1h`; the page's
 * own (`defaultTime`, else 24h) by default, which the query host leaves out of the URL. The data handlers read the
 * effective range: `time` also when it is the default.
 */
export const TIME = queryKey<TimeRange>(['time', 'range'], {
  parse(url, page) {
    const range = url.get('time') || page?.defaultTime || DEFAULT_TIME;
    return { range, custom: range === 'custom' ? (url.get('range') ?? '') : '' };
  },
  format: ({ range, custom }) => [['time', range], ...(range === 'custom' && custom ? [['range', custom] as const] : [])],
  sentToServer: true,
});

/** The time range of a tab's queries. */
export interface TimeRange {
  /** A preset as a Go duration (`1h`, `168h`), or `custom`. */
  readonly range: string;
  /** The custom range as the server reads it (`2026-10-29 10:00 to now-1h`); '' unless `range` is `custom`. */
  readonly custom: string;
}

/**
 * The custom range from `from` to `to`, each a time as the server reads it: `2026-10-29 10:00` (a selection on a time
 * chart, `formatTime`) or relative to now, `now-6h` (the time picker).
 */
export function customRange(from: string, to: string): TimeRange {
  return { range: 'custom', custom: `${from} to ${to}` };
}

/** The preset `range` (a Go duration, `1h`). */
export function presetRange(range: string): TimeRange {
  return { range, custom: '' };
}

/** The time range of a page that declares none. */
const DEFAULT_TIME = '24h';
