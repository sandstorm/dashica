// @vitest-environment jsdom
// Tests for dashboards.ts in the workbench: the menu, the page shown marked, favorites, search everywhere.
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
            { title: 'Orders', url: '/p/shop' },
            { title: 'Checkout', url: '/p/checkout' },
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

  it('keeps a starred dashboard among the favorites, for the next visit too; a second click removes it', () => {
    const star = () => [...menu().querySelectorAll<HTMLButtonElement>('.d-dashboards-menu__star')][1];
    star().click();
    expect(titles('.d-list__heading')).toEqual(['Favorites', 'Shop']);
    expect(titles('a')).toEqual(['Checkout', 'Orders', 'Checkout']);
    expect(JSON.parse(localStorage.getItem('dashica:global:dashboards:favorites')!)).toEqual([{ url: '/p/checkout', title: 'Checkout' }]);

    star().click();
    expect(titles('.d-list__heading')).toEqual(['Shop']);
  });

  it('finds the dashboards in search everywhere, with their group', async () => {
    host.querySelector<HTMLButtonElement>('.d-search-button')!.click();
    await settle();
    const options = [...host.querySelectorAll<HTMLElement>('[role=option]')].map((option) => option.textContent);
    expect(options).toContain('Orders Shop');
    expect(options).toContain('Checkout Shop');
  });
});
