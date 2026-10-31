// @vitest-environment jsdom
// Tests for dashboards.ts in the workbench: the menu, the active tab's page marked, favorites, "Open in new tab" with
// the workbench's tab bar, search everywhere (with the charts of searchEverywhere after the dashboards, Cmd / Ctrl+Enter
// in a new tab).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../core/disposable/disposable';
import { settle } from '../../hosts/widgets/widgets-testing';
import { createWorkbench } from '../../workbench/workbench';
import { dashboardPage } from '../dashboard-page/dashboard-page';
import { searchEverywhere } from '../search-everywhere/search-everywhere';
import { dashboards } from './dashboards';

let workbench: Disposable;
let host: HTMLElement;

beforeEach(async () => {
  history.replaceState(null, '', '/p/shop');
  vi.stubGlobal('fetch', async (url: string) =>
    new Response(JSON.stringify({ kind: 'dashboard', title: url, filterBar: false, filterButtons: [], widgets: [] })),
  );
  host = document.body.appendChild(document.createElement('div'));
  workbench = createWorkbench(host, {
    extensions: [dashboards, dashboardPage, searchEverywhere],
    workbench: {
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
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

const menu = () => host.querySelector<HTMLElement>('.d-dashboards-menu')!;
const link = (title: string) => [...menu().querySelectorAll('a')].find((a) => a.textContent === title)!;
const titles = (selector: string) => [...menu().querySelectorAll(selector)].map((el) => el.textContent);

describe('dashboards', () => {
  it('lists the groups and marks the page shown', () => {
    expect(titles('.d-list__heading')).toEqual(['Shop']);
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
    const more = [...menu().querySelectorAll<HTMLButtonElement>('.d-dashboards-menu__more')][1];
    more.click();
    [...host.querySelectorAll<HTMLElement>('[role=menuitem]')].find((item) => item.textContent?.includes('Open in new tab'))!.click();
    await settle();
    const tabs = () => [...host.querySelectorAll<HTMLElement>('[role=tab]')];
    expect(tabs().map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
      ['/p/shop/page.json', 'false'],
      ['/p/checkout/page.json', 'true'],
    ]);
    expect(location.pathname).toBe('/p/checkout');
    expect(titles('a.d-list__item--active')).toEqual(['Checkout']);
    tabs()[0].click();
    await settle();
    expect(location.pathname).toBe('/p/shop');
    expect(titles('a.d-list__item--active')).toEqual(['Orders']);
    host.querySelector<HTMLButtonElement>('[aria-label="Close /p/checkout/page.json"]')!.click();
    expect(tabs()).toHaveLength(1);
  });

  it('keeps a starred dashboard among the favorites, with its group, for the next visit too; its star there removes it', () => {
    const star = () => [...menu().querySelectorAll<HTMLButtonElement>('.d-dashboards-menu__star')][1];
    star().click();
    expect(titles('.d-list__heading')).toEqual(['Favorites', 'Shop']);
    expect(titles('a')).toEqual(['CheckoutShop', 'Orders', 'Checkout']);
    expect(titles('.d-dashboards-menu__group-name')).toEqual(['Shop']);
    expect(JSON.parse(localStorage.getItem('dashica:global:dashboards:favorites')!)).toEqual([{ url: '/p/checkout', title: 'Checkout' }]);

    // the favorite's own star, under "Favorites"
    menu().querySelector<HTMLButtonElement>('.d-dashboards-menu__star')!.click();
    expect(titles('.d-list__heading')).toEqual(['Shop']);
  });

  it('keeps a star toggled where it was on screen and focused, though the favorites above it grow or shrink', () => {
    const panel = menu().parentElement!;
    const star = () => [...menu().querySelectorAll<HTMLButtonElement>('.d-dashboards-menu__star')].at(-1)!;
    // jsdom lays out nothing: a favorite pushes the entries below it down by one row
    const rowHeight = 24;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rows = [...menu().querySelectorAll('.d-dashboards-menu__entry')];
      const top = rows.findIndex((row) => row.contains(this)) * rowHeight - panel.scrollTop;
      return { top, bottom: top + rowHeight, left: 0, right: 0, width: 0, height: rowHeight, x: 0, y: top, toJSON: () => ({}) };
    });
    star().focus();
    star().click();
    expect(panel.scrollTop).toBe(rowHeight);
    expect(document.activeElement).toBe(star());
    star().click();
    expect(panel.scrollTop).toBe(0);
  });

  it('finds the dashboards in search everywhere, with their group', async () => {
    host.querySelector<HTMLButtonElement>('.d-search-button')!.click();
    await settle();
    const options = [...host.querySelectorAll<HTMLElement>('[role=option]')].map((option) => option.textContent);
    expect(options).toContain('Orders Shop');
    expect(options).toContain('Checkout Shop');
  });

  it('ranks the dashboards before the charts in search everywhere, and opens a chart at its place', async () => {
    host.querySelector<HTMLButtonElement>('.d-search-button')!.click();
    const field = host.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;
    field.value = 'orders';
    field.dispatchEvent(new Event('input'));
    await settle();
    const options = [...host.querySelectorAll<HTMLElement>('[role=option]')];
    expect(options.map((option) => option.textContent)).toEqual(['Orders Shop', 'Checkout › Details › Orders per minute']);
    options[1].click();
    await settle();
    expect(location.pathname + location.hash).toBe('/p/checkout#w=3');
  });

  it('opens a dashboard picked with Cmd / Ctrl+Enter in search everywhere in a new tab', async () => {
    host.querySelector<HTMLButtonElement>('.d-search-button')!.click();
    const field = host.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;
    field.value = 'checkout';
    field.dispatchEvent(new Event('input'));
    await settle();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await settle();
    expect([...host.querySelectorAll('[role=tab]')]).toHaveLength(2);
    expect(location.pathname).toBe('/p/checkout');
  });
});
