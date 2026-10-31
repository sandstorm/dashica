// @vitest-environment jsdom
// Tests for QueryHost: the state from and into the URL, the structured filters, what each change asks of the widgets,
// auto refresh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryHost, formatTime } from './query';

let query: QueryHost;
let refreshes: number;

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, '', '/p/shop');
  query = new QueryHost(window);
  refreshes = 0;
  query.onDidRequestRefresh(() => refreshes++);
});

afterEach(() => {
  query.dispose();
  vi.useRealTimers();
});

const urlParams = () => Object.fromEntries(new URLSearchParams(location.search));

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  delete (document as { hidden?: boolean }).hidden;
});

describe('QueryHost', () => {
  it('takes the state from the URL, the page default for a missing time range', () => {
    history.replaceState(null, '', '/p/shop?sql=status+%3E%3D+500&wp=%7B%22path%22%3A%22%5E%2Fapi%22%7D&refresh=30');
    query.load({ defaultTime: '168h' });
    expect(query.time.range).toBe('168h');
    expect(query.time.autoRefresh).toBe(30);
    expect(query.filters.sql).toBe('status >= 500');
    expect(query.params.values).toEqual({ path: '^/api' });
    expect(refreshes).toBe(1);
  });

  it('falls back to 24h for a page without a default time range, and to no params for a broken wp', () => {
    history.replaceState(null, '', '/p/shop?wp=%5B1%5D');
    query.load();
    expect(query.time.range).toBe('24h');
    expect(query.params.values).toEqual({});
  });

  it('sends the keys of the page URL, the default time range included', () => {
    query.load();
    query.filters.setSql('status >= 500');
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

  it('adds a condition to the SQL filter with AND', () => {
    query.load();
    query.filters.add("status >= 500");
    query.filters.add("path = '/api'");
    expect(query.filters.sql).toBe("status >= 500 \nAND path = '/api'");
    expect(query.filters.fields).toEqual([]);
  });

  it('takes the structured filters from the URL’s f, the value everything after the second colon', () => {
    history.replaceState(null, '', '/p/shop?f=status:eq:500&f=path:ne:/api:v2&f=host:gt:a&f=:eq:a&f=host:eq');
    query.load();
    expect(query.filters.fields).toEqual([
      { fieldId: 'status', op: 'eq', value: '500' },
      { fieldId: 'path', op: 'ne', value: '/api:v2' },
    ]);
  });

  it('writes the structured filters into the URL as one f each, and reads them back', () => {
    query.load();
    query.filters.add('status', 'eq', '500');
    query.filters.add('path', 'ne', '/api:v2');
    vi.advanceTimersByTime(200);
    expect(new URLSearchParams(location.search).getAll('f')).toEqual(['status:eq:500', 'path:ne:/api:v2']);
    const written = query.filters.fields;
    query.load();
    expect(query.filters.fields).toEqual(written);
  });

  it('sends the structured filters as one f each', () => {
    query.load();
    query.filters.add('status', 'eq', '500');
    query.filters.add('host', 'ne', 'a');
    const sent = query.requestParams();
    expect([...sent.keys()]).toEqual(['time', 'f', 'f']);
    expect(sent.getAll('f')).toEqual(['status:eq:500', 'host:ne:a']);
  });

  it('adds a structured filter once, removes one by its index and clears them, keeping the SQL filter', () => {
    query.load();
    query.filters.setSql('status >= 500');
    refreshes = 0;
    query.filters.add('host', 'eq', 'a');
    query.filters.add('host', 'eq', 'a');
    query.filters.add('host', 'ne', 'b');
    query.filters.add('path', 'eq', '/api');
    expect(refreshes).toBe(3);
    query.filters.remove(1);
    expect(query.filters.fields).toEqual([
      { fieldId: 'host', op: 'eq', value: 'a' },
      { fieldId: 'path', op: 'eq', value: '/api' },
    ]);
    query.filters.clear();
    expect(query.filters.fields).toEqual([]);
    expect(refreshes).toBe(5);
    expect(query.filters.sql).toBe('status >= 500');
  });

  it('keeps the structured filters of a page out of the next page', () => {
    history.replaceState(null, '', '/p/shop?f=host:eq:a');
    query.load();
    history.pushState(null, '', '/p/billing');
    query.load();
    expect(query.filters.fields).toEqual([]);
  });

  it('writes the URL after a pause, leaving out what is the default', () => {
    query.load({ defaultTime: '1h' });
    query.time.setRange('3h');
    query.time.setAutoRefresh(30);
    expect(location.search).toBe('');
    vi.advanceTimersByTime(200);
    expect(urlParams()).toEqual({ time: '3h', refresh: '30' });
    query.time.setRange('1h');
    vi.advanceTimersByTime(200);
    expect(urlParams()).toEqual({ refresh: '30' });
  });

  it('keeps the hash when it writes the URL', () => {
    history.replaceState(null, '', '/p/shop#explore=3');
    query.load({ defaultTime: '1h' });
    query.time.setRange('3h');
    vi.advanceTimersByTime(200);
    expect(location.search + location.hash).toBe('?time=3h#explore=3');
    query.time.setRange('1h');
    vi.advanceTimersByTime(200);
    expect(location.pathname + location.search + location.hash).toBe('/p/shop#explore=3');
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

  it('keeps a change from before a load out of the URL of the next page', () => {
    query.load();
    query.filters.setSql('status >= 500');
    history.pushState(null, '', '/p/billing');
    query.load();
    vi.advanceTimersByTime(200);
    expect(location.search).toBe('');
    expect(query.filters.sql).toBe('');
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
});
