import type { QueryStateSpec } from '../../hosts/query/query';

/**
 * The id of the time range in a tab's query state (`query.state<TimeRange>(TIME_STATE)`): the `time-range` extension
 * registers it; a selection on a time chart sets it (`customRange`).
 */
export const TIME_STATE = 'time';

/** The time range of a tab's queries. */
export interface TimeRange {
  /** A preset as a Go duration (`1h`, `168h`), or `custom`. */
  readonly range: string;
  /** The custom range as the server reads it (`2026-10-29 10:00 to now-1h`); '' unless `range` is `custom`. */
  readonly custom: string;
}

/** The time range of a page that declares none. */
const DEFAULT_TIME = '24h';

/**
 * The time range in the URL, `?time=1h`, `?time=custom&range=now-6h to now-1h`; the page's own (`defaultTime`, else
 * 24h) by default. The data handlers read it, `time` also when it is the default: the server does not know the page's.
 */
export const timeState: QueryStateSpec<TimeRange> = {
  keys: ['time', 'range'],
  parse(url, page) {
    const range = url.get('time') || page?.defaultTime || DEFAULT_TIME;
    return { range, custom: range === 'custom' ? (url.get('range') ?? '') : '' };
  },
  format({ range, custom }, page) {
    return [...(range !== (page?.defaultTime || DEFAULT_TIME) ? [['time', range] as const] : []), ...(range === 'custom' && custom ? [['range', custom] as const] : [])];
  },
  request: ({ range, custom }) => [['time', range], ...(range === 'custom' ? [['range', custom] as const] : [])],
};

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
