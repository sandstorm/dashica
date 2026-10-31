import type { QueryStateSpec } from '../../hosts/query/query';

/**
 * The id of the auto refresh in a tab's query state (`query.state<AutoRefresh>(REFRESH_STATE)`): the `refresh`
 * extension registers it; the time range turns it off for a range that does not move.
 */
export const REFRESH_STATE = 'refresh';

/** The seconds between two automatic refreshes; `undefined`: no auto refresh. */
export type AutoRefresh = number | undefined;

/** The auto refresh in the URL, `?refresh=30` (none by default); the data handlers do not read it. */
export const refreshState: QueryStateSpec<AutoRefresh> = {
  keys: ['refresh'],
  parse(url) {
    const seconds = Number(url.get('refresh'));
    return seconds > 0 ? seconds : undefined;
  },
  format: (seconds) => (seconds ? [['refresh', String(seconds)]] : []),
};
