// @vitest-environment jsdom
// Tests for QueryHost: the state from and into a query string (parseSearch, formatSearch), the filter chips,
// what each change asks of the widgets, auto refresh paused while hidden or not shown; what a pill's key says of itself
// (pillLabel, pillButton, pillField).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryHost, formatSearch, formatTime, parseSearch, pillButton, pillField, pillLabel } from './query';

let query: QueryHost;
let refreshes: number;
/** The query strings `onDidChangeSearch` gave, in order. */
let searches: string[];

/** A key as the server signs a pill (`<payload>.<mac>`, the payload base64url JSON) with `label`; its mac is none. */
function keyOf(label: string, payload: object = {}): string {
  const json = new TextEncoder().encode(JSON.stringify({ condition: 'x', label, ...payload }));
  return `${btoa(String.fromCharCode(...json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.mac`;
}

/** The pill of `keyOf(label)`, as `/pill` answers it. */
function pill(label: string) {
  return { key: keyOf(label), label };
}

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

  it('takes the pills from the URL’s f as they are, each labelled as its key says; an empty f none', () => {
    query.load({ search: `?f=${keyOf('status = 500')}&f=&f=status:eq:500&f=${keyOf('path ≠ /api')}` });
    expect(query.filters.chips).toEqual([
      { kind: 'pill', key: keyOf('status = 500'), label: 'status = 500' },
      { kind: 'pill', key: 'status:eq:500', label: 'status:eq:500' },
      { kind: 'pill', key: keyOf('path ≠ /api'), label: 'path ≠ /api' },
    ]);
  });

  it('takes one chip per f and sql in the URL’s order; an old sql written by appending is one chip, an empty one none', () => {
    query.load({ search: `?sql=a+%0AAND+b&f=${keyOf('host = x')}&sql=&sql=duration+%3E+2000` });
    expect(query.filters.chips).toEqual([
      { kind: 'sql', sql: 'a \nAND b' },
      { kind: 'pill', key: keyOf('host = x'), label: 'host = x' },
      { kind: 'sql', sql: 'duration > 2000' },
    ]);
  });

  it('writes and sends the chips in their order, f and sql interleaved, and reads them back', () => {
    query.load({ search: '?tab=2' });
    query.filters.add('duration > 2000');
    query.filters.add(pill('host ≠ a'));
    query.filters.add("level != 'info'");
    vi.advanceTimersByTime(200);
    const written = new URLSearchParams(searches.at(-1));
    expect([...written]).toEqual([
      ['tab', '2'],
      ['sql', 'duration > 2000'],
      ['f', keyOf('host ≠ a')],
      ['sql', "level != 'info'"],
    ]);
    expect([...query.requestParams()].slice(1)).toEqual([...written].slice(1));
    const chips = query.filters.chips;
    query.load({ search: searches.at(-1) });
    expect(query.filters.chips).toEqual(chips);
  });

  it('replaces a chip in its place; a SQL chip of only spaces removes it, the same chip again changes nothing', () => {
    query.load({ search: `?sql=a&f=${keyOf('host = x')}&sql=b` });
    refreshes = 0;
    query.filters.replace(0, { kind: 'sql', sql: 'c' });
    query.filters.replace(1, { kind: 'pill', ...pill('host ≠ y') });
    query.filters.replace(1, { kind: 'pill', ...pill('host ≠ y') });
    expect(query.filters.chips).toEqual([
      { kind: 'sql', sql: 'c' },
      { kind: 'pill', ...pill('host ≠ y') },
      { kind: 'sql', sql: 'b' },
    ]);
    query.filters.replace(2, { kind: 'sql', sql: ' ' });
    query.filters.replace(5, { kind: 'sql', sql: 'd' });
    expect(query.filters.chips).toHaveLength(2);
    expect(refreshes).toBe(3);
  });

  it('sends the pills as one f each, their keys', () => {
    query.load();
    query.filters.add(pill('status = 500'));
    query.filters.add(pill('host ≠ a'));
    const sent = query.requestParams();
    expect([...sent.keys()]).toEqual(['time', 'f', 'f']);
    expect(sent.getAll('f')).toEqual([keyOf('status = 500'), keyOf('host ≠ a')]);
  });

  it('adds a pill once (by its key), removes a chip by its index and clears them all', () => {
    query.load();
    query.filters.add('status >= 500');
    refreshes = 0;
    query.filters.add(pill('host = a'));
    query.filters.add({ key: keyOf('host = a'), label: 'another label' });
    query.filters.add(pill('host ≠ b'));
    query.filters.add(pill('path = /api'));
    expect(refreshes).toBe(3);
    query.filters.remove(2);
    expect(query.filters.chips).toEqual([
      { kind: 'sql', sql: 'status >= 500' },
      { kind: 'pill', ...pill('host = a') },
      { kind: 'pill', ...pill('path = /api') },
    ]);
    query.filters.clear();
    expect(query.filters.chips).toEqual([]);
    expect(refreshes).toBe(5);
  });

  it('removes every chip a predicate holds for in one change, and none that is not there', () => {
    query.load({ search: `?sql=a+LIKE+%27x%25%27&f=${keyOf('host = a')}&sql=a+LIKE+%27y%25%27` });
    refreshes = 0;
    query.filters.remove((chip) => chip.kind === 'sql');
    expect(query.filters.chips).toEqual([{ kind: 'pill', ...pill('host = a') }]);
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
    expect(parseSearch(`?time=custom&range=now-6h+to+now&f=${keyOf('host = a')}&f=&refresh=30&wp=%7B%22path%22%3A%22x%22%7D`, '1h')).toEqual({
      range: 'custom',
      custom: 'now-6h to now',
      autoRefresh: 30,
      chips: [{ kind: 'pill', ...pill('host = a') }],
      params: { path: 'x' },
    });
    expect(parseSearch('', '1h')).toEqual({ range: '1h', custom: '', autoRefresh: undefined, chips: [], params: {} });
  });

  it('write it back, leaving out the default and keeping the other keys', () => {
    const state = parseSearch('?time=3h&sql=a&f=k.mac', '1h');
    expect(formatSearch(state, '1h', '?tab=x&time=6h')).toBe('?tab=x&time=3h&sql=a&f=k.mac');
    expect(formatSearch(parseSearch('', '1h'), '1h', '?sql=a')).toBe('');
  });
});

describe('pillLabel and pillButton', () => {
  it("read a pill's label, and the filter button it was made for with its value", () => {
    const duration = keyOf('Duration: 500', { button: 'duration_ms >= ...', value: '500' });
    expect([pillLabel(duration), pillButton(duration)]).toEqual(['Duration: 500', { button: 'duration_ms >= ...', value: '500' }]);
    expect(pillButton(keyOf('Errors', { button: 'status >= 500' }))).toEqual({ button: 'status >= 500', value: '' });
  });

  it('read no button from the pill of a field, and the key itself as the label of one without a payload', () => {
    expect(pillButton(keyOf('host = a'))).toBeUndefined();
    expect([pillLabel('status:eq:500'), pillButton('status:eq:500'), pillButton('!!.mac')]).toEqual(['status:eq:500', undefined, undefined]);
  });
});

describe('pillField', () => {
  const host = { connection: 'default', table: 'default.http_logs', field: 'host', op: 'ne', value: "O'Brien" };

  it("reads the table, field, op and shown value of a field's pill, an empty value too", () => {
    expect(pillField(keyOf("host ≠ O'Brien", host))).toEqual(host);
    expect(pillField(keyOf('host = ', { ...host, op: 'eq', value: '' }))).toEqual({ ...host, op: 'eq', value: '' });
  });

  it('reads none from a key without a value, signed before pills carried it', () => {
    expect(pillField(keyOf('host = acme', { ...host, op: 'eq', value: undefined }))).toBeUndefined();
  });

  it("reads none from a button's pill, a key without a field or op, or one without a payload", () => {
    const button = { connection: '', table: '', field: '', op: '', button: 'status >= 500' };
    expect([pillField(keyOf('Errors', button)), pillField(keyOf('host = a')), pillField(keyOf('host', { ...host, op: 'like' })), pillField('status:eq:500')]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
