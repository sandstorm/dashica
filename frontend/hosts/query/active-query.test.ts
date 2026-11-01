// @vitest-environment jsdom
// Tests for activeQuery in active-query.ts: reads and calls go to the active tab's query state, its events forward,
// a switch of tabs fires the keys' changes once and no refresh.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { QueryHost, QueryKeys, activeQuery, queryKey } from './query';

let shop: QueryHost;
let checkout: QueryHost;
let source: { activeQuery: QueryHost; onDidChangeTabs: EventEmitter<void>['event'] };
let tabsChanged: EventEmitter<void>;
let query: ReturnType<typeof activeQuery>;
let events: string[];

/** A key kept in `?colors=red`, '' by default, which the handlers read. */
const COLORS = queryKey<string>('colors', {
  parse: (url) => url.get('colors') ?? '',
  format: (value) => (value ? [['colors', value]] : []),
  sentToServer: true,
});

beforeEach(() => {
  // a key declared is known in every tab
  const keys = new QueryKeys();
  shop = new QueryHost(keys);
  checkout = new QueryHost(keys);
  tabsChanged = new EventEmitter<void>();
  source = { activeQuery: shop, onDidChangeTabs: tabsChanged.event };
  query = activeQuery(source);
  query.declare(COLORS);
  shop.load({ search: '?colors=red' });
  checkout.load({ search: '?colors=blue' });
  events = [];
  query.onDidChange(COLORS, () => events.push(`colors ${query.get(COLORS)}`));
  query.onDidRequestRefresh(() => events.push('refresh'));
});

afterEach(() => {
  query.dispose();
  shop.dispose();
  checkout.dispose();
});

const switchTo = (tab: QueryHost) => {
  source.activeQuery = tab;
  tabsChanged.fire();
};

describe('activeQuery', () => {
  it('reads and changes the active tab’s state', () => {
    expect(query.get(COLORS)).toBe('red');
    query.set(COLORS, 'green');
    expect(shop.get(COLORS)).toBe('green');
    expect(query.requestParams().get('colors')).toBe('green');
    expect(checkout.get(COLORS)).toBe('blue');
  });

  it('forwards the active tab’s events, and none of another tab', () => {
    shop.set(COLORS, 'green');
    checkout.set(COLORS, 'black');
    expect(events).toEqual(['colors green', 'refresh']);
  });

  it('fires each key’s change once on a switch, no refresh, then follows the tab shown', () => {
    switchTo(checkout);
    expect(events).toEqual(['colors blue']);
    events = [];
    shop.set(COLORS, 'green');
    checkout.set(COLORS, 'white');
    expect(events).toEqual(['colors white', 'refresh']);
    query.set(COLORS, 'black');
    expect(checkout.get(COLORS)).toBe('black');
    expect(shop.get(COLORS)).toBe('green');
  });

  it('fires nothing for a change of the tabs that keeps the active one, nor to a listener disposed', () => {
    tabsChanged.fire();
    expect(events).toEqual([]);
    const later: string[] = [];
    query.onDidChange(COLORS, () => later.push('second')).dispose();
    query.set(COLORS, 'green');
    expect(later).toEqual([]);
  });
});
