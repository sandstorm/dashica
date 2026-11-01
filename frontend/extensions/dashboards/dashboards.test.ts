// @vitest-environment jsdom
// Tests for dashboards.ts in the workbench: the menu (a view per group), the active tab's page marked, favorites
// (toggled, moved by dragging and by Alt+arrows), "Open in new tab" with the workbench's tab bar, search everywhere
// (with the charts of searchEverywhere after the dashboards, Cmd / Ctrl+Enter in a new tab), the start page "/".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../core/disposable/disposable';
import { settle } from '../../hosts/widgets/widgets-testing';
import { createWorkbench } from '../../workbench/workbench';
import { dashboardPage } from '../dashboard-page/dashboard-page';
import { searchEverywhere } from '../search-everywhere/search-everywhere';
import { dashboards } from './dashboards';

let workbench: Disposable;
let hostContainer: HTMLElement;

beforeEach(async () => {
  history.replaceState(null, '', '/p/shop');
  vi.stubGlobal('fetch', async (url: string) =>
    new Response(JSON.stringify({ kind: url === '/page.json' ? 'home' : 'dashboard', title: url, filterBar: false, filterButtons: [], widgets: [] })),
  );
  hostContainer = document.body.appendChild(document.createElement('div'));
  workbench = createWorkbench(hostContainer, {
    extensions: [dashboards, dashboardPage, searchEverywhere],
    workbench: {
      explore: false,
      sqlEnabled: false,
      connections: [],
      menu: [
        {
          title: 'Shop',
          entries: [
            { title: 'Orders', url: '/p/shop', outline: [] },
            { title: 'Checkout', url: '/p/checkout', outline: [{ id: '3', title: 'Orders per minute', group: 'Details' }] },
          ],
        },
      ],
    },
  });
  await settle();
});

afterEach(() => {
  workbench.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

const menu = () => hostContainer.querySelector<HTMLElement>('.d-dashboards-menu')!;
const link = (title: string) => [...menu().querySelectorAll('a')].find((linkElement) => linkElement.textContent === title)!;
const titles = (selector: string) => [...menu().querySelectorAll(selector)].map((titleElement) => titleElement.textContent);

describe('dashboards', () => {
  it('lists the groups as views and marks the page shown', () => {
    expect(titles('.d-view__title')).toEqual(['Shop']);
    expect(titles('a')).toEqual(['Orders', 'Checkout']);
    expect(titles('a.d-list__item--active')).toEqual(['Orders']);
  });

  it('opens a dashboard in the content area and marks it', async () => {
    link('Checkout').click();
    await settle();
    expect(location.pathname).toBe('/p/checkout');
    expect(titles('a.d-list__item--active')).toEqual(['Checkout']);
  });

  it('opens a dashboard in a new tab from its menu; the tab bar shows both, the mark follows the tab shown', async () => {
    const moreButtonElement = [...menu().querySelectorAll<HTMLButtonElement>('.d-dashboards-menu__more')][1];
    moreButtonElement.click();
    [...hostContainer.querySelectorAll<HTMLElement>('[role=option]')].find((itemElement) => itemElement.textContent?.includes('Open in new tab'))!.click();
    await settle();
    const tabs = () => [...hostContainer.querySelectorAll<HTMLElement>('[role=tab]')];
    expect(tabs().map((tabElement) => [tabElement.textContent, tabElement.getAttribute('aria-selected')])).toEqual([
      ['/p/shop/page.json', 'false'],
      ['/p/checkout/page.json', 'true'],
    ]);
    expect(location.pathname).toBe('/p/checkout');
    expect(titles('a.d-list__item--active')).toEqual(['Checkout']);
    tabs()[0].click();
    await settle();
    expect(location.pathname).toBe('/p/shop');
    expect(titles('a.d-list__item--active')).toEqual(['Orders']);
    hostContainer.querySelector<HTMLButtonElement>('[aria-label="Close /p/checkout/page.json"]')!.click();
    expect(tabs()).toHaveLength(1);
  });

  it('keeps a starred dashboard among the favorites, with its group, for the next visit too; its star there removes it', () => {
    const star = () => [...menu().querySelectorAll<HTMLButtonElement>('.d-dashboards-menu__star')][1];
    star().click();
    expect(titles('.d-view__title')).toEqual(['Favorites', 'Shop']);
    expect(titles('a')).toEqual(['CheckoutShop', 'Orders', 'Checkout']);
    expect(titles('.d-dashboards-menu__group-name')).toEqual(['Shop']);
    expect(JSON.parse(localStorage.getItem('dashica:global:dashboards:favorites')!)).toEqual([{ url: '/p/checkout', title: 'Checkout' }]);

    // the favorite's own star, under "Favorites"
    menu().querySelector<HTMLButtonElement>('.d-dashboards-menu__star')!.click();
    expect(titles('.d-view__title')).toEqual(['Shop']);
  });

  it('keeps a star toggled where it was on screen and focused, though the favorites above it grow or shrink', () => {
    const panelContainer = menu().parentElement!;
    const star = () => [...menu().querySelectorAll<HTMLButtonElement>('.d-dashboards-menu__star')].at(-1)!;
    // jsdom lays out nothing: a favorite pushes the entries below it down by one row
    const rowHeight = 24;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rowElements = [...menu().querySelectorAll('.d-dashboards-menu__entry')];
      const top = rowElements.findIndex((rowElement) => rowElement.contains(this)) * rowHeight - panelContainer.scrollTop;
      return { top, bottom: top + rowHeight, left: 0, right: 0, width: 0, height: rowHeight, x: 0, y: top, toJSON: () => ({}) };
    });
    star().focus();
    star().click();
    expect(panelContainer.scrollTop).toBe(rowHeight);
    expect(document.activeElement).toBe(star());
    star().click();
    expect(panelContainer.scrollTop).toBe(0);
  });

  it('closes the view of a group, and keeps it closed when the menu is drawn anew and for the next visit', async () => {
    const shop = () => [...menu().querySelectorAll<HTMLButtonElement>('.d-view__toggle')].find((toggleElement) => toggleElement.textContent?.includes('Shop'))!;
    shop().click();
    expect(shop().getAttribute('aria-expanded')).toBe('false');
    link('Checkout').click();
    await settle();
    expect(shop().getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('dashica:global:dashboards:views.group.Shop.collapsed')).toBe('true');
    // its count, while closed
    expect(shop().querySelector('.d-view__description')!.textContent).toBe('2');
  });

  describe('moving favorites', () => {
    const favorites = () => [...(menu().querySelector('[data-view=favorites]')?.querySelectorAll<HTMLElement>('.d-dashboards-menu__entry') ?? [])];
    const favoriteTitles = () => favorites().map((rowElement) => rowElement.querySelector('a')!.firstChild!.textContent);
    const stored = () => JSON.parse(localStorage.getItem('dashica:global:dashboards:favorites')!).map((f: { title: string }) => f.title);

    beforeEach(() => {
      // Orders, then Checkout
      for (const n of [0, 1]) [...menu().querySelectorAll<HTMLButtonElement>('.d-dashboards-menu__star')].at(-2 + n)!.click();
      expect(favoriteTitles()).toEqual(['Orders', 'Checkout']);
      // jsdom lays out nothing: each favorite one row of 24px below the one before
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const top = Math.max(0, favorites().indexOf(this)) * 24;
        return { top, bottom: top + 24, left: 0, right: 0, width: 0, height: 24, x: 0, y: top, toJSON: () => ({}) };
      });
    });

    const grip = (title: string) => favorites().find((rowElement) => rowElement.querySelector('a')!.firstChild!.textContent === title)!.querySelector('.d-dashboards-menu__grip')!;
    const pointer = (target: EventTarget, type: string, clientY: number) => target.dispatchEvent(new PointerEvent(type, { clientY, bubbles: true, cancelable: true }));

    it('moves a favorite dragged by its grip past the middle of another, and stores the order', () => {
      pointer(grip('Checkout'), 'pointerdown', 30);
      pointer(document, 'pointermove', 20);
      expect(favoriteTitles()).toEqual(['Orders', 'Checkout']);
      pointer(document, 'pointermove', 6);
      expect(favoriteTitles()).toEqual(['Checkout', 'Orders']);
      pointer(document, 'pointerup', 6);
      expect(favoriteTitles()).toEqual(['Checkout', 'Orders']);
      expect(stored()).toEqual(['Checkout', 'Orders']);
      // the next move starts from the order stored
      pointer(grip('Checkout'), 'pointerdown', 6);
      pointer(document, 'pointermove', 40);
      pointer(document, 'pointerup', 40);
      expect(stored()).toEqual(['Orders', 'Checkout']);
    });

    it('puts a dragged favorite back on Escape', () => {
      pointer(grip('Checkout'), 'pointerdown', 30);
      pointer(document, 'pointermove', 6);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(favoriteTitles()).toEqual(['Orders', 'Checkout']);
      pointer(document, 'pointerup', 6);
      expect(stored()).toEqual(['Orders', 'Checkout']);
    });

    it('moves a favorite with Alt+ArrowUp / Alt+ArrowDown, its focused part keeping the focus', () => {
      const linkOf = (title: string) => favorites().find((rowElement) => rowElement.querySelector('a')!.firstChild!.textContent === title)!.querySelector('a')!;
      expect(linkOf('Checkout').getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown');
      const press = (key: string, altKey = true) =>
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, altKey, bubbles: true, cancelable: true }));
      linkOf('Checkout').focus();
      press('ArrowUp', false);
      expect(favoriteTitles()).toEqual(['Orders', 'Checkout']);
      press('ArrowUp');
      expect(favoriteTitles()).toEqual(['Checkout', 'Orders']);
      expect(stored()).toEqual(['Checkout', 'Orders']);
      expect(document.activeElement).toBe(linkOf('Checkout'));
      // at the top already
      press('ArrowUp');
      expect(favoriteTitles()).toEqual(['Checkout', 'Orders']);
      press('ArrowDown');
      expect(stored()).toEqual(['Orders', 'Checkout']);
      expect(document.activeElement).toBe(linkOf('Checkout'));
    });
  });

  describe('the start page', () => {
    const home = () => hostContainer.querySelector<HTMLElement>('.d-home-page')!;
    const homeTitles = (selector: string) => [...home().querySelectorAll(selector)].map((titleElement) => titleElement.textContent);
    /** "+" in the tab bar: the start page in a new tab. */
    const newTab = () => hostContainer.querySelector<HTMLButtonElement>('[data-testid=wb-tab-add]')!.click();

    it('is what "+" opens: a hint while there are no favorites, then the groups with their dashboards', async () => {
      newTab();
      await settle();
      expect(location.pathname).toBe('/');
      expect(homeTitles('h2')).toEqual(['Favorites', 'Shop']);
      expect(homeTitles('.d-home-page__hint')).toHaveLength(1);
      expect(homeTitles('.d-home-page__dashboard')).toEqual(['Orders', 'Checkout']);
    });

    it('shows the favorites as tiles with their group, in their order, as they change', async () => {
      const star = (n: number) => [...menu().querySelectorAll<HTMLButtonElement>('.d-dashboards-menu__star')].at(n)!;
      star(-1).click();
      newTab();
      await settle();
      expect(homeTitles('.d-home-page__tile')).toEqual(['CheckoutShop']);
      star(-2).click();
      expect(homeTitles('.d-home-page__tile')).toEqual(['CheckoutShop', 'OrdersShop']);
      expect(homeTitles('.d-home-page__hint')).toHaveLength(0);
      // Checkout's own star, under "Favorites"
      star(0).click();
      expect(homeTitles('.d-home-page__tile')).toEqual(['OrdersShop']);
      home().querySelector<HTMLAnchorElement>('.d-home-page__tile')!.click();
      await settle();
      expect(location.pathname).toBe('/p/shop');
    });
  });

  it('finds the dashboards in search everywhere, with their group', async () => {
    hostContainer.querySelector<HTMLButtonElement>('[data-testid=wb-rail-button-search]')!.click();
    await settle();
    const options = [...hostContainer.querySelectorAll<HTMLElement>('[role=option]')].map((optionElement) => optionElement.textContent);
    expect(options).toContain('Orders Shop');
    expect(options).toContain('Checkout Shop');
  });

  it('ranks the dashboards before the charts in search everywhere, and opens a chart at its place', async () => {
    hostContainer.querySelector<HTMLButtonElement>('[data-testid=wb-rail-button-search]')!.click();
    const fieldElement = hostContainer.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;
    fieldElement.value = 'orders';
    fieldElement.dispatchEvent(new Event('input'));
    await settle();
    const optionElements = [...hostContainer.querySelectorAll<HTMLElement>('[role=option]')];
    expect(optionElements.map((optionElement) => optionElement.textContent)).toEqual(['Orders Shop', 'Checkout › Details › Orders per minute']);
    optionElements[1].click();
    await settle();
    expect(location.pathname + location.hash).toBe('/p/checkout#w=3');
  });

  it('opens a dashboard picked with Cmd / Ctrl+Enter in search everywhere in a new tab', async () => {
    hostContainer.querySelector<HTMLButtonElement>('[data-testid=wb-rail-button-search]')!.click();
    const fieldElement = hostContainer.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;
    fieldElement.value = 'checkout';
    fieldElement.dispatchEvent(new Event('input'));
    await settle();
    fieldElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await settle();
    expect([...hostContainer.querySelectorAll('[role=tab]')]).toHaveLength(2);
    expect(location.pathname).toBe('/p/checkout');
  });
});
