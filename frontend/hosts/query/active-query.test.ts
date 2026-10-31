// @vitest-environment jsdom
// Tests for activeQuery in active-query.ts: reads and calls go to the active tab's query state, its events forward,
// a switch of tabs fires the models' and the registered states' changes once and no refresh.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { QueryHost, QueryStates, activeQuery, type QueryState, type QueryStateSpec } from './query';

let shop: QueryHost;
let checkout: QueryHost;
let source: { activeQuery: QueryHost; onDidChangeTabs: EventEmitter<void>['event'] };
let tabsChanged: EventEmitter<void>;
let query: ReturnType<typeof activeQuery>;
let events: string[];
let colors: QueryState<string>;

/** A state kept in `?colors=red`, '' by default, which the handlers read. */
const colorsSpec: QueryStateSpec<string> = {
  keys: ['colors'],
  parse: (url) => url.get('colors') ?? '',
  format: (value) => (value ? [['colors', value]] : []),
  request: (value) => [['colors', value]],
};

beforeEach(() => {
  // one tab's registrations are every tab's
  const states = new QueryStates();
  shop = new QueryHost(states);
  checkout = new QueryHost(states);
  tabsChanged = new EventEmitter<void>();
  source = { activeQuery: shop, onDidChangeTabs: tabsChanged.event };
  query = activeQuery(source);
  colors = query.registerState('colors', colorsSpec);
  shop.load({ search: '?colors=red&f=pill-host-a' });
  checkout.load({ search: '?colors=blue' });
  events = [];
  colors.onDidChange(() => events.push(`colors ${colors.get()}`));
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
    expect(colors.get()).toBe('red');
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
    expect(query.requestParams().get('colors')).toBe('red');
    expect(checkout.filters.chips).toEqual([]);
  });

  it('forwards the active tab’s events, and none of another tab', () => {
    shop.state<string>('colors')!.set('green');
    checkout.state<string>('colors')!.set('black');
    expect(events).toEqual(['colors green', 'refresh']);
  });

  it('fires each model’s change once on a switch, no refresh, then follows the tab shown', () => {
    switchTo(checkout);
    expect(events).toEqual(['filters', 'params', 'colors blue']);
    events = [];
    shop.state<string>('colors')!.set('green');
    checkout.filters.add('status >= 500');
    expect(events).toEqual(['filters', 'refresh']);
    colors.set('black');
    expect(checkout.state('colors')?.get()).toBe('black');
    expect(shop.state('colors')?.get()).toBe('green');
    expect(query.state('colors')).toBe(query.state('colors'));
  });

  it('fires nothing for a change of the tabs that keeps the active one', () => {
    tabsChanged.fire();
    expect(events).toEqual([]);
  });
});
