// @vitest-environment jsdom
// Tests for refresh.ts: refresh now from the button and the command, the auto refresh interval (the query state
// `refresh`), its timer paused while the browser tab is hidden or the tab is in the background, catching up once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost, QueryStates, activeQuery } from '../../hosts/query/query';
import { REFRESH_STATE, type AutoRefresh } from '../time-library/refresh-state';
import { refresh } from './refresh';

let shop: QueryHost;
let checkout: QueryHost;
let query: ReturnType<typeof activeQuery>;
let page: { tabs: { id: string; url: string; title: string }[]; activeTab: { id: string; url: string; title: string } };
let tabsChanged: EventEmitter<void>;
let bar: HTMLElement;
let commands: Map<string, () => void>;
let subscriptions: { dispose(): unknown }[];
/** The refreshes the shop tab was asked for. */
let refreshes: number;

beforeEach(() => {
  vi.useFakeTimers();
  const states = new QueryStates();
  shop = new QueryHost(states);
  checkout = new QueryHost(states);
  const tabs = [
    { id: 'shop', url: '/p/shop', title: 'Shop' },
    { id: 'checkout', url: '/p/checkout', title: 'Checkout' },
  ];
  tabsChanged = new EventEmitter<void>();
  page = { tabs, activeTab: tabs[0] };
  query = activeQuery({
    get activeQuery() {
      return page.activeTab.id === 'shop' ? shop : checkout;
    },
    onDidChangeTabs: tabsChanged.event,
  });
  bar = document.body.appendChild(document.createElement('div'));
  commands = new Map();
  subscriptions = [];
  const context = {
    query,
    page: {
      get tabs() {
        return page.tabs;
      },
      get activeTab() {
        return page.activeTab;
      },
      onDidChangeTabs: tabsChanged.event,
    },
    subscriptions,
    ui: {
      registerBarItem: (_bar: string, el: HTMLElement) => {
        bar.appendChild(el);
        return { dispose: () => el.remove() };
      },
    },
    commands: { registerCommand: (id: string, run: () => void) => (commands.set(id, run), { dispose: () => commands.delete(id) }) },
  };
  refresh.activate(context as unknown as ExtensionContext);
  shop.load({ search: '?refresh=45' });
  refreshes = 0;
  shop.onDidRequestRefresh(() => refreshes++);
});

afterEach(() => {
  for (const subscription of subscriptions.reverse()) subscription.dispose();
  query.dispose();
  shop.dispose();
  checkout.dispose();
  document.body.replaceChildren();
  delete (document as { hidden?: boolean }).hidden;
  vi.useRealTimers();
});

const interval = () => bar.querySelector('select')!;

function pick(value: string): void {
  interval().value = value;
  interval().dispatchEvent(new Event('change'));
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

function show(id: string): void {
  page.activeTab = page.tabs.find((tab) => tab.id === id)!;
  tabsChanged.fire();
}

const seconds = (tab: QueryHost) => tab.state<AutoRefresh>(REFRESH_STATE)?.get();

describe('refresh', () => {
  it('refreshes from its button and its command', () => {
    bar.querySelector<HTMLButtonElement>('button[aria-label=Refresh]')!.click();
    commands.get('refresh.now')!();
    expect(refreshes).toBe(2);
  });

  it('shows the URL’s interval, also one not offered, and sets the one picked, which the handlers do not read', () => {
    expect(interval().value).toBe('45');
    expect(interval().selectedOptions[0].textContent).toBe('45s');
    pick('');
    expect(seconds(shop)).toBeUndefined();
    pick('60');
    expect(seconds(shop)).toBe(60);
    expect(interval().selectedOptions[0].textContent).toBe('1m');
    expect(refreshes).toBe(0);
    expect(shop.requestParams().has('refresh')).toBe(false);
  });

  it('refreshes every interval while auto refresh is on, a whole one after it was picked', () => {
    pick('30');
    vi.advanceTimersByTime(29_999);
    expect(refreshes).toBe(0);
    vi.advanceTimersByTime(30_001);
    expect(refreshes).toBe(2);
    pick('');
    vi.advanceTimersByTime(60_000);
    expect(refreshes).toBe(2);
  });

  it('ticks a whole interval after any refresh', () => {
    pick('30');
    vi.advanceTimersByTime(20_000);
    query.refresh();
    vi.advanceTimersByTime(29_999);
    expect(refreshes).toBe(1);
    vi.advanceTimersByTime(1);
    expect(refreshes).toBe(2);
  });

  it('skips the auto refresh while the browser tab is hidden and refreshes once when it is shown again', () => {
    pick('30');
    setHidden(true);
    vi.advanceTimersByTime(90_000);
    expect(refreshes).toBe(0);
    setHidden(false);
    expect(refreshes).toBe(1);
    vi.advanceTimersByTime(29_999);
    expect(refreshes).toBe(1);
    vi.advanceTimersByTime(1);
    expect(refreshes).toBe(2);
  });

  it('waits for the rest of the interval when it did not pass while hidden', () => {
    pick('30');
    setHidden(true);
    vi.advanceTimersByTime(10_000);
    setHidden(false);
    expect(refreshes).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(refreshes).toBe(1);
  });

  it('forgets an interval passed while hidden when auto refresh is turned off', () => {
    pick('30');
    setHidden(true);
    vi.advanceTimersByTime(30_000);
    pick('');
    setHidden(false);
    expect(refreshes).toBe(0);
  });

  it('pauses the auto refresh of a tab in the background and catches up once when it is shown', () => {
    pick('30');
    show('checkout');
    vi.advanceTimersByTime(90_000);
    expect(refreshes).toBe(0);
    show('shop');
    expect(refreshes).toBe(1);
    vi.advanceTimersByTime(30_000);
    expect(refreshes).toBe(2);
  });

  it('keeps each tab’s interval, and shows the active tab’s', () => {
    checkout.load({ search: '?refresh=10' });
    show('checkout');
    expect(interval().value).toBe('10');
    pick('60');
    expect(seconds(checkout)).toBe(60);
    expect(seconds(shop)).toBe(45);
    show('shop');
    expect(interval().value).toBe('45');
  });

  it('stops its timer when disposed', () => {
    pick('30');
    for (const subscription of subscriptions.splice(0).reverse()) subscription.dispose();
    vi.advanceTimersByTime(90_000);
    expect(refreshes).toBe(0);
  });
});
