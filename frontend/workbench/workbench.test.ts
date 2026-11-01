// @vitest-environment jsdom
// Tests for workbench.ts: the top bar's controls showing the active tab's query state after a switch of tabs, "+" for
// a new tab, the global menu's "…" at the left rail's start, a popped-out view's tab without the top bar's items and
// the filter bar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../core/disposable/disposable';
import { dashboardPage } from '../extensions/dashboard-page/dashboard-page';
import { refresh } from '../extensions/refresh/refresh';
import { timeRange } from '../extensions/time-range/time-range';
import type { PageApi } from '../hosts/page/page';
import type { UiApi } from '../hosts/ui/ui';
import { settle } from '../hosts/widgets/widgets-testing';
import { createWorkbench } from './workbench';

let workbench: Disposable;
let hostContainer: HTMLElement;
/** The workbench's `ui`, as an extension sees it. */
let ui: UiApi;
/** The workbench's `page`, as an extension sees it. */
let page: PageApi;

beforeEach(async () => {
  // two tabs from before a reload, the shop one active
  sessionStorage.setItem(
    'dashica:workbench:tabs',
    JSON.stringify({
      tabs: [
        { id: 'shop', url: '/p/shop?time=1h&refresh=30', title: 'Shop' },
        { id: 'checkout', url: '/p/checkout?time=6h', title: 'Checkout' },
      ],
      active: 'shop',
    }),
  );
  history.replaceState({ tab: 'shop' }, '', '/p/shop?time=1h&refresh=30');
  const titles: Record<string, string> = { '/p/shop/page.json': 'Shop', '/p/checkout/page.json': 'Checkout' };
  vi.stubGlobal('fetch', async (url: string) =>
    new Response(JSON.stringify({ kind: 'dashboard', title: titles[url], filterBar: false, filterButtons: [], widgets: [] })),
  );
  hostContainer = document.body.appendChild(document.createElement('div'));
  const grab = { id: 'test', activate: (context: { ui: UiApi; page: PageApi }) => void ((ui = context.ui), (page = context.page)) };
  workbench = createWorkbench(hostContainer, { extensions: [dashboardPage, timeRange, refresh, grab], workbench: { menu: [], explore: false, sqlEnabled: false, connections: [] } });
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

const rangeButton = () => hostContainer.querySelector<HTMLButtonElement>('button[aria-haspopup=dialog].d-segmented__item')!;
const interval = () => hostContainer.querySelector<HTMLSelectElement>('select[aria-label="Auto refresh"]')!;
const tab = (title: string) => [...hostContainer.querySelectorAll<HTMLElement>('[role=tab]')].find((tabElement) => tabElement.textContent === title)!;

describe('createWorkbench', () => {
  it('shows the active tab’s time range and auto refresh in the top bar, after each switch', async () => {
    expect(tab('Shop').getAttribute('aria-selected')).toBe('true');
    expect(rangeButton().textContent).toBe('Last 1 hour');
    expect(interval().value).toBe('30');

    tab('Checkout').click();
    await settle();
    expect(location.search).toBe('?time=6h');
    expect(rangeButton().textContent).toBe('Last 6 hours');
    expect(interval().value).toBe('');

    tab('Shop').click();
    expect(rangeButton().textContent).toBe('Last 1 hour');
    expect(interval().value).toBe('30');
  });

  it('opens the start page in a new tab with "+", after the active one', async () => {
    hostContainer.querySelector<HTMLButtonElement>('[data-testid=wb-tab-add]')!.click();
    await settle();
    expect(hostContainer.querySelectorAll('[role=tab]')).toHaveLength(3);
    expect(location.pathname).toBe('/');
    expect(hostContainer.querySelectorAll('[role=tab]')[1].getAttribute('aria-selected')).toBe('true');
  });

  it('shows the global menu’s "…" first in the left rail while the menu has entries, and the menu on a click', async () => {
    const buttonElement = hostContainer.querySelector<HTMLButtonElement>('[data-testid=wb-global-menu]')!;
    expect(hostContainer.querySelector('.d-workbench__side--left .d-workbench__rail button')).toBe(buttonElement);
    expect(hostContainer.querySelector('[data-testid=wb-top-bar] [data-testid=wb-global-menu]')).toBeNull();
    expect(buttonElement.hidden).toBe(true);
    const entry = ui.registerMenuItem('workbench/global', { command: 'test.global', title: 'Something global' });
    expect(buttonElement.hidden).toBe(false);
    buttonElement.click();
    const optionElements = [...hostContainer.querySelectorAll<HTMLElement>('[role=option]')];
    expect(optionElements.map((optionElement) => optionElement.textContent)).toEqual(['Something global']);
    entry.dispose();
    expect(buttonElement.hidden).toBe(true);
  });

  it('shows a popped-out view’s tab with the tabs only in the top bar and no filter bar; the page’s tab with them again', async () => {
    const filterBarContainer = hostContainer.querySelector<HTMLElement>('[data-testid=wb-filter-bar]')!;
    ui.registerBarItem('filter', document.createElement('span'), { alignment: 'left' });
    const shown = (checkedElement: Element) => !checkedElement.closest('[hidden]');
    expect(shown(rangeButton())).toBe(true);
    expect(shown(filterBarContainer)).toBe(true);

    await page.popOut({ title: 'Debug: Requests', render: (viewContainer) => ((viewContainer.textContent = 'debug'), Disposable.from()) });
    expect(shown(tab('Debug: Requests'))).toBe(true);
    expect(shown(hostContainer.querySelector('[data-testid=wb-tab-add]')!)).toBe(true);
    expect(shown(rangeButton())).toBe(false);
    expect(shown(interval())).toBe(false);
    expect(shown(filterBarContainer)).toBe(false);

    tab('Shop').click();
    expect(shown(rangeButton())).toBe(true);
    expect(shown(interval())).toBe(true);
    expect(shown(filterBarContainer)).toBe(true);
  });
});
