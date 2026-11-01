import { queryKey } from '../../hosts/query/query';

/**
 * The auto refresh of a tab's query state (`query.get(REFRESH)`), run by the `refresh` extension; the time range turns
 * it off for a fixed range. In the URL, `?refresh=30` (none by default); only the browser reads it.
 */
export const REFRESH = queryKey<AutoRefresh>('refresh', {
  parse(url) {
    const seconds = Number(url.get('refresh'));
    return seconds > 0 ? seconds : undefined;
  },
  format: (seconds) => (seconds ? [['refresh', String(seconds)]] : []),
});

/** The seconds between two automatic refreshes; `undefined`: no auto refresh. */
export type AutoRefresh = number | undefined;
