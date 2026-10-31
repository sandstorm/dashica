// Tests for tabs.ts: opening after the active tab, the same URL shown instead, the limit, closing and who becomes
// active, the next and previous tab, restoring after a reload.
import { describe, expect, it } from 'vitest';
import { TAB_LIMIT, adjacentTab, closeTab, openTab, restoreTabs, showTab, singleTab, storedTabs, titleOf, updateTab, type Tab, type TabList } from './tabs';

const tab = (id: string, url = `/p/${id}`): Tab => ({ id, url, title: id });
const ids = (list: TabList) => list.tabs.map((t) => t.id);

/** shop, then checkout and billing opened from it, billing shown. */
const three = () => openTab(openTab(singleTab(tab('shop')), tab('billing')), tab('checkout'), TAB_LIMIT);

describe('tabs', () => {
  it('opens a tab after the active one and shows it', () => {
    const list = openTab(openTab(singleTab(tab('shop')), tab('billing')), tab('checkout'));
    expect(ids(list)).toEqual(['shop', 'billing', 'checkout']);
    expect(list.active).toBe('checkout');
    const fromShop = openTab(showTab(list, 'shop'), tab('orders'));
    expect(ids(fromShop)).toEqual(['shop', 'orders', 'billing', 'checkout']);
  });

  it('shows the tab with the same URL instead of opening another', () => {
    const list = openTab(three(), tab('again', '/p/shop'));
    expect(ids(list)).toEqual(['shop', 'billing', 'checkout']);
    expect(list.active).toBe('shop');
  });

  it('closes the tab shown least recently beyond the limit', () => {
    let list = openTab(singleTab(tab('shop')), tab('billing'), 3);
    list = showTab(list, 'shop');
    list = openTab(list, tab('checkout'), 3);
    list = openTab(list, tab('orders'), 3);
    expect(ids(list)).toEqual(['shop', 'checkout', 'orders']);
    expect(list.active).toBe('orders');
  });

  it('makes the tab shown before active when the active one closes; another closed keeps the active one', () => {
    let list = showTab(three(), 'shop');
    list = showTab(list, 'checkout');
    expect(closeTab(list, 'checkout').active).toBe('shop');
    const closed = closeTab(list, 'billing');
    expect(ids(closed)).toEqual(['shop', 'checkout']);
    expect(closed.active).toBe('checkout');
  });

  it('keeps the last tab open, and changes nothing for an id not open', () => {
    const one = singleTab(tab('shop'));
    expect(closeTab(one, 'shop')).toBe(one);
    expect(closeTab(three(), 'gone').tabs).toHaveLength(3);
    expect(showTab(three(), 'gone').active).toBe('checkout');
  });

  it('changes a tab’s URL and title, keeping the others', () => {
    const list = updateTab(three(), 'billing', { url: '/p/billing?time=1h', title: 'Billing' });
    expect(list.tabs[1]).toEqual({ id: 'billing', url: '/p/billing?time=1h', title: 'Billing' });
    expect(list.tabs[0]).toEqual(tab('shop'));
  });

  it('names the next and the previous tab, round the end', () => {
    const { tabs } = three();
    expect(adjacentTab(tabs, 'checkout', 1)).toBe('shop');
    expect(adjacentTab(tabs, 'shop', -1)).toBe('checkout');
    expect(adjacentTab(tabs, 'shop', 1)).toBe('billing');
  });

  describe('restoreTabs', () => {
    const stored = () => JSON.parse(JSON.stringify(storedTabs(showTab(three(), 'billing'))));

    it('brings the tabs back in their order, the address bar’s URL in the tab its entry names, shown', () => {
      const list = restoreTabs(stored(), '/p/shop?time=1h', 'shop', 'new');
      expect(ids(list)).toEqual(['shop', 'billing', 'checkout']);
      expect(list.active).toBe('shop');
      expect(list.tabs[0].url).toBe('/p/shop?time=1h');
      expect(list.tabs[1]).toEqual(tab('billing'));
    });

    it('puts the URL into the stored active tab for an entry without a tab (a URL typed)', () => {
      const list = restoreTabs(stored(), '/p/orders', undefined, 'new');
      expect(list.active).toBe('billing');
      expect(list.tabs[1]).toEqual({ id: 'billing', url: '/p/orders', title: '/p/orders' });
    });

    it('starts with one tab of the URL without stored tabs, or with anything else stored', () => {
      for (const nothing of [undefined, null, 'x', { tabs: [{ id: 1 }], active: 'a' }, { tabs: [], active: 'a' }]) {
        expect(restoreTabs(nothing, '/p/shop#w=3', undefined, 'new')).toEqual(singleTab({ id: 'new', url: '/p/shop#w=3', title: '/p/shop' }));
      }
    });
  });

  it('titles a tab without a page by its URL’s path', () => {
    expect(titleOf('/p/shop?time=1h#w=3')).toBe('/p/shop');
  });
});
