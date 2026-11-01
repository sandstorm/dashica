// @vitest-environment jsdom
// Tests for QueryHost: typed keys (queryKey) read from the URL, written into it after a pause with its other keys
// kept, sent, asking for a refresh, shared by the tabs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageJson } from '../../generated/zz_generated.dashica';
import { QueryHost, QueryKeys, queryKey, type QueryKey } from './query';

let query: QueryHost;
let refreshes: number;
/** The query strings `onDidChangeSearch` gave, in order. */
let searches: string[];

beforeEach(() => {
  vi.useFakeTimers();
  query = new QueryHost();
  refreshes = 0;
  searches = [];
  query.onDidRequestRefresh(() => refreshes++);
  query.onDidChangeSearch((search) => searches.push(search));
});

afterEach(() => {
  query.dispose();
  vi.useRealTimers();
});

/** A key kept in `?<name>=red,blue`, none by default; `sent`: the handlers read it. */
function listKey(name: string, sent: boolean): QueryKey<readonly string[]> {
  return queryKey<readonly string[]>(name, {
    parse: (url) => url.get(name)?.split(',') ?? [],
    format: (colors) => (colors.length > 0 ? [[name, colors.join(',')]] : []),
    sentToServer: sent ? true : undefined,
  });
}

const COLORS = listKey('colors', false);

describe('queryKey', () => {
  it('is sent for `sentToServer: true`, not without', () => {
    expect(listKey('colors', true).sentToServer).toBe(true);
    expect(COLORS.sentToServer).toBe(false);
    expect(queryKey('size', { parse: () => '', format: () => [] }).urlKeys).toEqual(['size']);
  });
});

describe('QueryHost', () => {
  it('reads a key from the URL, the default for a missing key, again after each load', () => {
    expect(query.get(COLORS)).toEqual([]);
    const changes: string[][] = [];
    query.onDidChange(COLORS, () => changes.push([...query.get(COLORS)]));
    query.load({ search: '?colors=red,blue' });
    expect(changes).toEqual([['red', 'blue']]);
    expect(query.get(COLORS)).toEqual(['red', 'blue']);
  });

  it('reads and writes a key with the default of the page loaded', () => {
    const size = queryKey<string>('size', {
      parse: (url, page) => url.get('size') ?? page?.title ?? '',
      format: (value, page) => (value !== page?.title ? [['size', value]] : []),
    });
    query.load({ page: { kind: 'dashboard', title: 'xl', filterBar: false, filterButtons: [], widgets: [] } });
    expect(query.get(size)).toBe('xl');
    query.set(size, 's');
    vi.advanceTimersByTime(200);
    query.set(size, 'xl');
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['?size=s', '']);
  });

  it('keeps a change from before a load out of the query string of the next page', () => {
    query.load();
    query.set(COLORS, ['red']);
    query.load();
    vi.advanceTimersByTime(200);
    expect(searches).toEqual([]);
    expect(query.get(COLORS)).toEqual([]);
  });

  it('reads a key first used after the load from the URL loaded', () => {
    query.load({ search: '?colors=red' });
    expect(query.get(COLORS)).toEqual(['red']);
  });

  it('writes a set value into its keys after a pause, keeping the other keys, and nothing for one the URL holds alike', () => {
    query.load({ search: '?tab=2&colors=red' });
    query.set(COLORS, ['red']);
    vi.advanceTimersByTime(200);
    expect(searches).toEqual([]);
    query.set(COLORS, ['blue', 'green']);
    vi.advanceTimersByTime(200);
    query.set(COLORS, []);
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['?tab=2&colors=blue%2Cgreen', '?tab=2']);
  });

  it('fires a change only for another value, and none after the listener is disposed', () => {
    query.load();
    let changes = 0;
    const listening = query.onDidChange(COLORS, () => changes++);
    query.set(COLORS, []);
    query.set(COLORS, ['red']);
    query.set(COLORS, ['red']);
    expect(changes).toBe(1);
    listening.dispose();
    query.set(COLORS, ['blue']);
    expect(changes).toBe(1);
  });

  it('sends a key the handlers read and queries again on its change; one they do not read neither', () => {
    const sent = listKey('colors', true);
    const kept = listKey('sizes', false);
    query.load({ search: '?colors=red&sizes=xl' });
    query.get(kept);
    refreshes = 0;
    expect(query.requestParams().getAll('colors')).toEqual([]);
    query.get(sent);
    expect(query.requestParams().getAll('colors')).toEqual(['red']);
    expect(query.requestParams().has('sizes')).toBe(false);
    query.set(kept, ['s']);
    expect(refreshes).toBe(0);
    query.set(sent, ['blue']);
    expect(refreshes).toBe(1);
    expect(query.requestParams().get('colors')).toBe('blue');
  });

  it('sends a key’s URL entries with the page loaded: its default left out, as in the URL', () => {
    const size = queryKey<string>('size', {
      parse: (url, page) => url.get('size') ?? page?.defaultTime ?? '24h',
      format: (value, page) => (value !== (page?.defaultTime ?? '24h') ? [['size', value]] : []),
      sentToServer: true,
    });
    const page: PageJson = { kind: 'dashboard', title: 'Shop', defaultTime: '168h', filterBar: false, filterButtons: [], widgets: [] };
    query.load({ search: '', page });
    expect(query.get(size)).toBe('168h');
    expect(query.requestParams().has('size')).toBe(false);
    query.set(size, '24h');
    expect(query.requestParams().get('size')).toBe('24h');
    query.load({ search: '?size=168h', page });
    expect(query.requestParams().has('size')).toBe(false);
  });

  it('knows a key used in one tab in every tab sharing the keys, each tab with its own value', () => {
    const keys = new QueryKeys();
    const shop = new QueryHost(keys);
    const checkout = new QueryHost(keys);
    const sent = listKey('colors', true);
    shop.load({ search: '?colors=red' });
    checkout.load({ search: '?colors=blue' });
    shop.get(sent);
    expect(checkout.requestParams().get('colors')).toBe('blue');
    checkout.set(sent, ['green']);
    expect(shop.get(sent)).toEqual(['red']);
    expect(checkout.requestParams().get('colors')).toBe('green');
    shop.dispose();
    checkout.dispose();
  });

  it('refuses a second key of the same URL key', () => {
    query.get(COLORS);
    expect(() => query.get(listKey('colors', true))).toThrow('The URL key colors belongs to another query key');
  });
});
