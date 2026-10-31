// @vitest-environment jsdom
// Tests for QueryHost: the states extensions register (registerState) read from the URL, written into it after a pause
// with its other keys kept, sent, asking for a refresh, shared by the tabs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryHost, QueryStates, type QueryStateSpec } from './query';

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

/** The keys of the query string given last. */
const urlParams = () => Object.fromEntries(new URLSearchParams(searches.at(-1) ?? ''));

/** A state kept in `?colors=red,blue`, none by default; `sent`: the handlers read it. */
function colorsSpec(sent: boolean): QueryStateSpec<readonly string[]> {
  return {
    keys: ['colors'],
    parse: (url) => url.get('colors')?.split(',') ?? [],
    format: (colors) => (colors.length > 0 ? [['colors', colors.join(',')]] : []),
    request: sent ? (colors) => [['colors', colors.join(',')]] : undefined,
  };
}

describe('QueryHost', () => {
  it('reads a state from the URL, the default for a missing key, again after each load', () => {
    const colors = query.registerState('colors', colorsSpec(false));
    expect(colors.get()).toEqual([]);
    const changes: string[][] = [];
    colors.onDidChange(() => changes.push([...colors.get()]));
    query.load({ search: '?colors=red,blue' });
    expect(changes).toEqual([['red', 'blue']]);
    expect(query.state('colors')?.get()).toEqual(['red', 'blue']);
  });

  it('reads and writes a state with the default of the page loaded', () => {
    const size = query.registerState<string>('size', {
      keys: ['size'],
      parse: (url, page) => url.get('size') ?? page?.title ?? '',
      format: (value, page) => (value !== page?.title ? [['size', value]] : []),
    });
    query.load({ page: { kind: 'dashboard', title: 'xl', filterBar: false, filterButtons: [], widgets: [] } });
    expect(size.get()).toBe('xl');
    size.set('s');
    vi.advanceTimersByTime(200);
    size.set('xl');
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['?size=s', '']);
  });

  it('keeps a change from before a load out of the query string of the next page', () => {
    const colors = query.registerState('colors', colorsSpec(false));
    query.load();
    colors.set(['red']);
    query.load();
    vi.advanceTimersByTime(200);
    expect(searches).toEqual([]);
    expect(colors.get()).toEqual([]);
  });

  it('reads a state registered after the load from the URL loaded', () => {
    query.load({ search: '?colors=red' });
    expect(query.registerState('colors', colorsSpec(false)).get()).toEqual(['red']);
  });

  it('writes a set value into its keys after a pause, keeping the other keys, and nothing for one the URL holds alike', () => {
    const colors = query.registerState('colors', colorsSpec(false));
    query.load({ search: '?tab=2&colors=red' });
    colors.set(['red']);
    vi.advanceTimersByTime(200);
    expect(searches).toEqual([]);
    colors.set(['blue', 'green']);
    vi.advanceTimersByTime(200);
    colors.set([]);
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['?tab=2&colors=blue%2Cgreen', '?tab=2']);
  });

  it('fires a change only for another value', () => {
    const colors = query.registerState('colors', colorsSpec(false));
    query.load();
    let changes = 0;
    colors.onDidChange(() => changes++);
    colors.set([]);
    colors.set(['red']);
    colors.set(['red']);
    expect(changes).toBe(1);
  });

  it('sends a state the handlers read and queries again on its change; one they do not read neither', () => {
    const sent = query.registerState('colors', colorsSpec(true));
    const kept = query.registerState('sizes', { ...colorsSpec(false), keys: ['sizes'], parse: (url) => url.get('sizes')?.split(',') ?? [] });
    query.load({ search: '?colors=red&sizes=xl' });
    refreshes = 0;
    expect(query.requestParams().getAll('colors')).toEqual(['red']);
    expect(query.requestParams().has('sizes')).toBe(false);
    kept.set(['s']);
    expect(refreshes).toBe(0);
    sent.set(['blue']);
    expect(refreshes).toBe(1);
    expect(query.requestParams().get('colors')).toBe('blue');
  });

  it('keeps a state for every tab sharing the registered states, each tab with its own value', () => {
    const states = new QueryStates();
    const shop = new QueryHost(states);
    const checkout = new QueryHost(states);
    shop.registerState('colors', colorsSpec(true));
    shop.load({ search: '?colors=red' });
    checkout.load({ search: '?colors=blue' });
    checkout.state<readonly string[]>('colors')!.set(['green']);
    expect(shop.state('colors')?.get()).toEqual(['red']);
    expect(checkout.requestParams().get('colors')).toBe('green');
    shop.dispose();
    checkout.dispose();
  });

  it('refuses a second state of the same id or URL key, and forgets a state disposed', () => {
    const colors = query.registerState('colors', colorsSpec(true));
    expect(() => query.registerState('colors', colorsSpec(false))).toThrow('There is a query state colors already');
    expect(() => query.registerState('palette', colorsSpec(false))).toThrow("The URL key colors of the query state palette is another state's");
    query.load({ search: '?colors=red' });
    colors.dispose();
    expect(query.state('colors')).toBeUndefined();
    expect(query.requestParams().has('colors')).toBe(false);
  });
});
