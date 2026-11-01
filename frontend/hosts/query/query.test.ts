// @vitest-environment jsdom
// Tests for QueryHost: typed keys (queryKey) declared, read from the URL, written into it after a pause with its
// other keys kept, sent in the order declared, asking for a refresh, shared by the tabs; an undeclared key refused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageJson } from '../../generated/zz_generated.dashica';
import { QueryHost, QueryKeys, queryKey, type QueryKey } from './query';

/** A key kept in `?<name>=red,blue`, none by default; `sent`: the handlers read it. */
function listKey(name: string, sent: boolean): QueryKey<readonly string[]> {
  return queryKey<readonly string[]>(name, {
    parse: (url) => url.get(name)?.split(',') ?? [],
    format: (colors) => (colors.length > 0 ? [[name, colors.join(',')]] : []),
    sentToServer: sent ? true : undefined,
  });
}

const COLORS = listKey('colors', false);

let query: QueryHost;
let refreshes: number;
/** The query strings `onDidChangeSearch` gave, in order. */
let searches: string[];

beforeEach(() => {
  vi.useFakeTimers();
  query = new QueryHost();
  query.declare(COLORS);
  refreshes = 0;
  searches = [];
  query.onDidRequestRefresh(() => refreshes++);
  query.onDidChangeSearch((search) => searches.push(search));
});

afterEach(() => {
  query.dispose();
  vi.useRealTimers();
});

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

  it('reads a key with the default of the page loaded, and leaves the default out of the URL', () => {
    const size = queryKey<string>('size', {
      parse: (url, page) => url.get('size') ?? page?.title ?? '',
      format: (value) => [['size', value]],
    });
    query.declare(size);
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

  it('reads a key first read after the load from the URL loaded', () => {
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

  it('sends a key the handlers read, read or not, and queries again on its change; one they do not read neither', () => {
    const keys = new QueryKeys();
    const tab = new QueryHost(keys);
    const sent = listKey('colors', true);
    const kept = listKey('sizes', false);
    keys.declare(sent);
    keys.declare(kept);
    tab.onDidRequestRefresh(() => refreshes++);
    tab.load({ search: '?colors=red&sizes=xl' });
    refreshes = 0;
    expect(tab.requestParams().getAll('colors')).toEqual(['red']);
    expect(tab.requestParams().has('sizes')).toBe(false);
    tab.set(kept, ['s']);
    expect(refreshes).toBe(0);
    tab.set(sent, ['blue']);
    expect(refreshes).toBe(1);
    expect(tab.requestParams().get('colors')).toBe('blue');
    tab.dispose();
  });

  it('sends a key’s effective value, its page’s default too, which the URL leaves out', () => {
    const size = queryKey<string>('size', {
      parse: (url, page) => url.get('size') ?? page?.defaultTime ?? '24h',
      format: (value) => [['size', value]],
      sentToServer: true,
    });
    query.declare(size);
    const page: PageJson = { kind: 'dashboard', title: 'Shop', defaultTime: '168h', filterBar: false, filterButtons: [], widgets: [] };
    query.load({ search: '', page });
    expect(query.get(size)).toBe('168h');
    expect(query.requestParams().get('size')).toBe('168h');
    query.set(size, '24h');
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['?size=24h']);
    expect(query.requestParams().get('size')).toBe('24h');
    query.set(size, '168h');
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['?size=24h', '']);
    query.load({ search: '?size=168h', page });
    expect(query.requestParams().get('size')).toBe('168h');
  });

  it('leaves a key’s default out of the URL without a page too, and sends it', () => {
    const size = queryKey<string>('size', {
      parse: (url, page) => url.get('size') ?? page?.defaultTime ?? '24h',
      format: (value) => [['size', value]],
      sentToServer: true,
    });
    query.declare(size);
    query.load({ search: '?size=1h' });
    query.set(size, '24h');
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['']);
    expect(query.requestParams().get('size')).toBe('24h');
  });

  it('knows a key declared in one tab in every tab sharing the keys, each tab with its own value', () => {
    const keys = new QueryKeys();
    const shop = new QueryHost(keys);
    const checkout = new QueryHost(keys);
    const sent = listKey('colors', true);
    shop.declare(sent);
    shop.load({ search: '?colors=red' });
    checkout.load({ search: '?colors=blue' });
    expect(checkout.requestParams().get('colors')).toBe('blue');
    checkout.set(sent, ['green']);
    expect(shop.get(sent)).toEqual(['red']);
    expect(checkout.requestParams().get('colors')).toBe('green');
    shop.dispose();
    checkout.dispose();
  });

  it('refuses to declare a second key of the same URL key, or the same key twice', () => {
    expect(() => query.declare(queryKey<string>(['size', 'colors'], { parse: () => '', format: () => [] }))).toThrow('The URL key colors belongs to a query key declared before');
    expect(() => query.declare(COLORS)).toThrow('The URL key colors belongs to a query key declared before');
  });

  it('refuses a key no extension declared, in get, set and onDidChange alike', () => {
    const sizes = listKey('sizes', true);
    const undeclared = 'The query key sizes is not declared: no extension declared it (query.declare)';
    expect(() => query.get(sizes)).toThrow(undeclared);
    expect(() => query.set(sizes, ['s'])).toThrow(undeclared);
    expect(() => query.onDidChange(sizes, () => {})).toThrow(undeclared);
  });

  it('writes and sends the keys in the order declared, and a key disposed no more', () => {
    const sizes = listKey('sizes', true);
    const colors = listKey('colors', true);
    const keys = new QueryKeys();
    const tab = new QueryHost(keys);
    keys.declare(sizes);
    const colorsDeclared = keys.declare(colors);
    tab.onDidChangeSearch((search) => searches.push(search));
    tab.load({ search: '?colors=red&sizes=xl' });
    expect([...tab.requestParams().keys()]).toEqual(['sizes', 'colors']);
    tab.set(sizes, ['s']);
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['?sizes=s&colors=red']);
    colorsDeclared.dispose();
    expect([...tab.requestParams().keys()]).toEqual(['sizes']);
    expect(() => tab.get(colors)).toThrow('The query key colors is not declared');
    tab.dispose();
  });
});
