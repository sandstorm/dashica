// @vitest-environment jsdom
// Tests for QueryHost: the state from and into a query string (parseSearch, formatSearch), the filter chips,
// what each change asks of the widgets, auto refresh paused while hidden or not shown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryHost, formatSearch, formatTime, parseSearch } from './query';

let query: QueryHost;
let refreshes: number;
/** The query strings `onDidChangeSearch` gave, in order. */
let searches: string[];

beforeEach(() => {
  vi.useFakeTimers();
  query = new QueryHost(window);
  refreshes = 0;
  searches = [];
  query.onDidRequestRefresh(() => refreshes++);
  query.onDidChangeSearch((search) => searches.push(search));
});

afterEach(() => {
  query.dispose();
  vi.useRealTimers();
});

/** The keys of the query string given last. */
const urlParams = () => Object.fromEntries(new URLSearchParams(searches.at(-1) ?? ''));

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  delete (document as { hidden?: boolean }).hidden;
});

describe('QueryHost', () => {
  it('takes the state from the URL, the page default for a missing time range', () => {
    query.load({ search: '?sql=status+%3E%3D+500&wp=%7B%22path%22%3A%22%5E%2Fapi%22%7D&refresh=30', defaultTime: '168h' });
    expect(query.time.range).toBe('168h');
    expect(query.time.autoRefresh).toBe(30);
    expect(query.filters.chips).toEqual([{ kind: 'sql', sql: 'status >= 500' }]);
    expect(query.params.values).toEqual({ path: '^/api' });
    expect(refreshes).toBe(1);
  });

  it('falls back to 24h for a page without a default time range, and to no params for a broken wp', () => {
    query.load({ search: '?wp=%5B1%5D' });
    expect(query.time.range).toBe('24h');
    expect(query.params.values).toEqual({});
  });

  it('sends the keys of the page URL, the default time range included', () => {
    query.load();
    query.filters.add('status >= 500');
    query.params.set('path', '^/api');
    const sent = query.requestParams();
    expect([...sent.keys()]).toEqual(['time', 'sql', 'wp']);
    expect(sent.get('time')).toBe('24h');
    expect(sent.get('sql')).toBe('status >= 500');
    expect(JSON.parse(sent.get('wp')!)).toEqual({ path: '^/api' });
  });

  it('sends a custom range with its ends', () => {
    query.load();
    query.time.setCustom('now-6h', 'now-1h');
    expect(query.requestParams().toString()).toBe(new URLSearchParams({ time: 'custom', range: 'now-6h to now-1h' }).toString());
  });

  it('sends only the time range while there is no SQL filter and no param', () => {
    query.load();
    expect(query.requestParams().toString()).toBe('time=24h');
  });

  it('asks the widgets to query again when the time, the filter or a param changes, but not for auto refresh', () => {
    query.load();
    refreshes = 0;
    query.time.setRange('1h');
    query.filters.add('status >= 500');
    query.params.set('path', '^/api');
    expect(refreshes).toBe(3);
    query.time.setAutoRefresh(30);
    expect(refreshes).toBe(3);
  });

  it('adds a condition as a SQL chip of its own, once; one of only spaces is none', () => {
    query.load();
    refreshes = 0;
    query.filters.add('status >= 500');
    query.filters.add("path = '/api'");
    query.filters.add('status >= 500');
    query.filters.add('  ');
    expect(query.filters.chips).toEqual([
      { kind: 'sql', sql: 'status >= 500' },
      { kind: 'sql', sql: "path = '/api'" },
    ]);
    expect(refreshes).toBe(2);
  });

  it('takes the structured filters from the URL’s f, the value everything after the second colon', () => {
    query.load({ search: '?f=status:eq:500&f=path:ne:/api:v2&f=host:gt:a&f=:eq:a&f=host:eq' });
    expect(query.filters.chips).toEqual([
      { kind: 'field', fieldId: 'status', op: 'eq', value: '500' },
      { kind: 'field', fieldId: 'path', op: 'ne', value: '/api:v2' },
    ]);
  });

  it('takes one chip per f and sql in the URL’s order; an old sql written by appending is one chip, an empty one none', () => {
    query.load({ search: '?sql=a+%0AAND+b&f=host:eq:x&sql=&sql=duration+%3E+2000' });
    expect(query.filters.chips).toEqual([
      { kind: 'sql', sql: 'a \nAND b' },
      { kind: 'field', fieldId: 'host', op: 'eq', value: 'x' },
      { kind: 'sql', sql: 'duration > 2000' },
    ]);
  });

  it('writes and sends the chips in their order, f and sql interleaved, and reads them back', () => {
    query.load({ search: '?tab=2' });
    query.filters.add('duration > 2000');
    query.filters.add('host', 'ne', 'a');
    query.filters.add("level != 'info'");
    vi.advanceTimersByTime(200);
    const written = new URLSearchParams(searches.at(-1));
    expect([...written]).toEqual([
      ['tab', '2'],
      ['sql', 'duration > 2000'],
      ['f', 'host:ne:a'],
      ['sql', "level != 'info'"],
    ]);
    expect([...query.requestParams()].slice(1)).toEqual([...written].slice(1));
    const chips = query.filters.chips;
    query.load({ search: searches.at(-1) });
    expect(query.filters.chips).toEqual(chips);
  });

  it('replaces a chip in its place; a SQL chip of only spaces removes it, the same chip again changes nothing', () => {
    query.load({ search: '?sql=a&f=host:eq:x&sql=b' });
    refreshes = 0;
    query.filters.replace(0, { kind: 'sql', sql: 'c' });
    query.filters.replace(1, { kind: 'field', fieldId: 'host', op: 'ne', value: 'y' });
    query.filters.replace(1, { kind: 'field', fieldId: 'host', op: 'ne', value: 'y' });
    expect(query.filters.chips).toEqual([
      { kind: 'sql', sql: 'c' },
      { kind: 'field', fieldId: 'host', op: 'ne', value: 'y' },
      { kind: 'sql', sql: 'b' },
    ]);
    query.filters.replace(2, { kind: 'sql', sql: ' ' });
    query.filters.replace(5, { kind: 'sql', sql: 'd' });
    expect(query.filters.chips).toHaveLength(2);
    expect(refreshes).toBe(3);
  });

  it('writes the structured filters into the URL as one f each, and reads them back', () => {
    query.load();
    query.filters.add('status', 'eq', '500');
    query.filters.add('path', 'ne', '/api:v2');
    vi.advanceTimersByTime(200);
    expect(new URLSearchParams(searches.at(-1)).getAll('f')).toEqual(['status:eq:500', 'path:ne:/api:v2']);
    const written = query.filters.chips;
    query.load({ search: searches.at(-1) });
    expect(query.filters.chips).toEqual(written);
  });

  it('sends the structured filters as one f each', () => {
    query.load();
    query.filters.add('status', 'eq', '500');
    query.filters.add('host', 'ne', 'a');
    const sent = query.requestParams();
    expect([...sent.keys()]).toEqual(['time', 'f', 'f']);
    expect(sent.getAll('f')).toEqual(['status:eq:500', 'host:ne:a']);
  });

  it('adds a structured filter once, removes a chip by its index and clears them all', () => {
    query.load();
    query.filters.add('status >= 500');
    refreshes = 0;
    query.filters.add('host', 'eq', 'a');
    query.filters.add('host', 'eq', 'a');
    query.filters.add('host', 'ne', 'b');
    query.filters.add('path', 'eq', '/api');
    expect(refreshes).toBe(3);
    query.filters.remove(2);
    expect(query.filters.chips).toEqual([
      { kind: 'sql', sql: 'status >= 500' },
      { kind: 'field', fieldId: 'host', op: 'eq', value: 'a' },
      { kind: 'field', fieldId: 'path', op: 'eq', value: '/api' },
    ]);
    query.filters.clear();
    expect(query.filters.chips).toEqual([]);
    expect(refreshes).toBe(5);
  });

  it('removes every chip a predicate holds for in one change, and none that is not there', () => {
    query.load({ search: '?sql=a+LIKE+%27x%25%27&f=host:eq:a&sql=a+LIKE+%27y%25%27' });
    refreshes = 0;
    query.filters.remove((chip) => chip.kind === 'sql');
    expect(query.filters.chips).toEqual([{ kind: 'field', fieldId: 'host', op: 'eq', value: 'a' }]);
    query.filters.remove((chip) => chip.kind === 'sql');
    query.filters.remove(5);
    expect(refreshes).toBe(1);
  });

  it('keeps the structured filters of a page out of the next page', () => {
    query.load({ search: '?f=host:eq:a' });
    query.load({ search: '' });
    expect(query.filters.chips).toEqual([]);
  });

  it('gives the query string after a pause, leaving out what is the default', () => {
    query.load({ defaultTime: '1h' });
    query.time.setRange('3h');
    query.time.setAutoRefresh(30);
    expect(searches).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(urlParams()).toEqual({ time: '3h', refresh: '30' });
    query.time.setRange('1h');
    query.time.setAutoRefresh(undefined);
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['?time=3h&refresh=30', '']);
  });

  it('keeps the other keys of the query string it was loaded from, and gives nothing for a state as loaded', () => {
    query.load({ search: '?tab=2&time=1h', defaultTime: '24h' });
    query.time.setRange('3h');
    query.time.setRange('1h');
    vi.advanceTimersByTime(200);
    expect(searches).toEqual([]);
    query.time.setRange('6h');
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['?tab=2&time=6h']);
  });

  it('writes a custom range with the viewer’s local time', () => {
    query.load();
    query.time.setCustom(formatTime(new Date(2026, 9, 29, 10, 0)), formatTime(new Date(2026, 9, 29, 12, 30)));
    vi.advanceTimersByTime(200);
    expect(urlParams()).toEqual({ time: 'custom', range: '2026-10-29 10:00 to 2026-10-29 12:30' });
    expect(query.time.custom).toBe('2026-10-29 10:00 to 2026-10-29 12:30');
  });

  it('writes a custom range relative to now as it is', () => {
    query.load();
    query.time.setCustom('now-6h', 'now-1h');
    vi.advanceTimersByTime(200);
    expect(urlParams()).toEqual({ time: 'custom', range: 'now-6h to now-1h' });
  });

  it('keeps a change from before a load out of the query string of the next page', () => {
    query.load();
    query.filters.add('status >= 500');
    query.load();
    vi.advanceTimersByTime(200);
    expect(searches).toEqual([]);
    expect(query.filters.chips).toEqual([]);
  });

  it('refreshes every interval while auto refresh is on', () => {
    query.load();
    refreshes = 0;
    query.time.setAutoRefresh(30);
    vi.advanceTimersByTime(60_000);
    expect(refreshes).toBe(2);
    query.time.setAutoRefresh(undefined);
    vi.advanceTimersByTime(60_000);
    expect(refreshes).toBe(2);
  });

  it('skips the auto refresh while the tab is hidden and refreshes once when it is shown again', () => {
    query.load();
    query.time.setAutoRefresh(30);
    refreshes = 0;
    setHidden(true);
    vi.advanceTimersByTime(90_000);
    expect(refreshes).toBe(0);
    setHidden(false);
    expect(refreshes).toBe(1);
    vi.advanceTimersByTime(30_000);
    expect(refreshes).toBe(2);
  });

  it('ticks a whole interval after the refresh when the tab is shown again', () => {
    query.load();
    query.time.setAutoRefresh(30);
    refreshes = 0;
    setHidden(true);
    vi.advanceTimersByTime(35_000);
    setHidden(false);
    expect(refreshes).toBe(1);
    vi.advanceTimersByTime(29_999);
    expect(refreshes).toBe(1);
    vi.advanceTimersByTime(1);
    expect(refreshes).toBe(2);
  });

  it('waits for the next tick when none came while the tab was hidden', () => {
    query.load();
    query.time.setAutoRefresh(30);
    refreshes = 0;
    setHidden(true);
    vi.advanceTimersByTime(10_000);
    setHidden(false);
    expect(refreshes).toBe(0);
  });

  it('forgets a skipped tick when auto refresh is turned off', () => {
    query.load();
    query.time.setAutoRefresh(30);
    refreshes = 0;
    setHidden(true);
    vi.advanceTimersByTime(30_000);
    query.time.setAutoRefresh(undefined);
    setHidden(false);
    expect(refreshes).toBe(0);
  });

  it('skips the auto refresh while its tab is not shown and refreshes once when it is shown again', () => {
    query.load();
    query.time.setAutoRefresh(30);
    refreshes = 0;
    query.setShown(false);
    vi.advanceTimersByTime(90_000);
    expect(refreshes).toBe(0);
    query.setShown(true);
    expect(refreshes).toBe(1);
    vi.advanceTimersByTime(29_999);
    expect(refreshes).toBe(1);
    vi.advanceTimersByTime(1);
    expect(refreshes).toBe(2);
  });

  it('stays paused while its tab is not shown, though the browser tab is shown again', () => {
    query.load();
    query.time.setAutoRefresh(30);
    refreshes = 0;
    query.setShown(false);
    setHidden(true);
    vi.advanceTimersByTime(30_000);
    setHidden(false);
    expect(refreshes).toBe(0);
    query.setShown(true);
    expect(refreshes).toBe(1);
  });

  it('refreshes nothing when its tab is shown again without a skipped tick (no auto refresh)', () => {
    query.load();
    refreshes = 0;
    query.setShown(false);
    vi.advanceTimersByTime(90_000);
    query.setShown(true);
    expect(refreshes).toBe(0);
  });
});

describe('parseSearch and formatSearch', () => {
  it('read the state of a query string, the default for what it lacks', () => {
    expect(parseSearch('?time=custom&range=now-6h+to+now&f=host:eq:a&f=bad&refresh=30&wp=%7B%22path%22%3A%22x%22%7D', '1h')).toEqual({
      range: 'custom',
      custom: 'now-6h to now',
      autoRefresh: 30,
      chips: [{ kind: 'field', fieldId: 'host', op: 'eq', value: 'a' }],
      params: { path: 'x' },
    });
    expect(parseSearch('', '1h')).toEqual({ range: '1h', custom: '', autoRefresh: undefined, chips: [], params: {} });
  });

  it('write it back, leaving out the default and keeping the other keys', () => {
    const state = parseSearch('?time=3h&sql=a&f=host:ne:b', '1h');
    expect(formatSearch(state, '1h', '?tab=x&time=6h')).toBe('?tab=x&time=3h&sql=a&f=host%3Ane%3Ab');
    expect(formatSearch(parseSearch('', '1h'), '1h', '?sql=a')).toBe('');
  });
});
