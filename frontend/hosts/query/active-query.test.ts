// @vitest-environment jsdom
// Tests for activeQuery in active-query.ts: reads and calls go to the active tab's query state, its events forward,
// a switch of tabs fires the models' changes once and no refresh.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { QueryHost, QueryStates, activeQuery } from './query';

let shop: QueryHost;
let checkout: QueryHost;
let source: { activeQuery: QueryHost; onDidChangeTabs: EventEmitter<void>['event'] };
let tabsChanged: EventEmitter<void>;
let query: ReturnType<typeof activeQuery>;
let events: string[];

beforeEach(() => {
  // one tab's registrations are every tab's
  const states = new QueryStates();
  shop = new QueryHost(window, states);
  checkout = new QueryHost(window, states);
  shop.load({ search: '?time=1h&f=pill-host-a' });
  checkout.load({ search: '?time=6h' });
  tabsChanged = new EventEmitter<void>();
  source = { activeQuery: shop, onDidChangeTabs: tabsChanged.event };
  query = activeQuery(source);
  events = [];
  query.time.onDidChange(() => events.push('time'));
  query.filters.onDidChange(() => events.push('filters'));
  query.params.onDidChange(() => events.push('params'));
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
    expect(query.time.range).toBe('1h');
    expect(query.filters.chips).toEqual([{ kind: 'pill', key: 'pill-host-a' }]);
    query.filters.add({ key: 'pill-status-500' });
    query.filters.add('path LIKE \'/api%\'');
    query.filters.replace(0, { kind: 'pill', key: 'pill-host-not-a' });
    query.params.set('path', '/x');
    expect(shop.filters.chips).toEqual([
      { kind: 'pill', key: 'pill-host-not-a' },
      { kind: 'pill', key: 'pill-status-500' },
      { kind: 'sql', sql: "path LIKE '/api%'" },
    ]);
    expect(shop.params.values).toEqual({ path: '/x' });
    expect(query.requestParams().get('time')).toBe('1h');
    expect(checkout.filters.chips).toEqual([]);
  });

  it('forwards the active tab’s events, and none of another tab', () => {
    shop.time.setRange('3h');
    checkout.time.setRange('12h');
    expect(events).toEqual(['time', 'refresh']);
  });

  it('fires each model’s change once on a switch, no refresh, then follows the tab shown', () => {
    switchTo(checkout);
    expect(events).toEqual(['time', 'filters', 'params']);
    expect(query.time.range).toBe('6h');
    events = [];
    shop.time.setRange('3h');
    checkout.filters.add('status >= 500');
    expect(events).toEqual(['filters', 'refresh']);
    query.time.setRange('2h');
    expect(checkout.time.range).toBe('2h');
    expect(shop.time.range).toBe('3h');
  });

  it('gives a registered state’s value in the active tab, firing its change once on a switch', () => {
    const colors = query.registerState<string>('colors', { keys: ['colors'], parse: (url) => url.get('colors') ?? '', format: (value) => (value ? [['colors', value]] : []) });
    shop.load({ search: '?colors=red' });
    checkout.load({ search: '?colors=blue' });
    events = [];
    colors.onDidChange(() => events.push(`colors ${colors.get()}`));
    switchTo(checkout);
    expect(events).toContain('colors blue');
    colors.set('green');
    expect(checkout.state('colors')?.get()).toBe('green');
    expect(shop.state('colors')?.get()).toBe('red');
    events = [];
    shop.state<string>('colors')!.set('black');
    expect(events).toEqual([]);
    expect(query.state('colors')).toBe(query.state('colors'));
  });

  it('fires nothing for a change of the tabs that keeps the active one', () => {
    tabsChanged.fire();
    expect(events).toEqual([]);
  });
});
