// @vitest-environment jsdom
// Tests for workbench.ts: the top bar's controls showing the active tab's query state after a switch of tabs, "+" for
// a new tab, the global menu's "…".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../core/disposable/disposable';
import { dashboardPage } from '../extensions/dashboard-page/dashboard-page';
import { refresh } from '../extensions/refresh/refresh';
import { timeRange } from '../extensions/time-range/time-range';
import type { UiApi } from '../hosts/ui/ui';
import { settle } from '../hosts/widgets/widgets-testing';
import { createWorkbench } from './workbench';

let workbench: Disposable;
let host: HTMLElement;
/** The workbench's `ui`, as an extension sees it. */
let ui: UiApi;

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
  host = document.body.appendChild(document.createElement('div'));
  const grab = { id: 'test', activate: (context: { ui: UiApi }) => void (ui = context.ui) };
  workbench = createWorkbench(host, { extensions: [dashboardPage, timeRange, refresh, grab], workbench: { menu: [], explore: false, connections: [] } });
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

const rangeButton = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup=dialog].d-segmented__item')!;
const interval = () => host.querySelector<HTMLSelectElement>('select[aria-label="Auto refresh"]')!;
const tab = (title: string) => [...host.querySelectorAll<HTMLElement>('[role=tab]')].find((el) => el.textContent === title)!;

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
    host.querySelector<HTMLButtonElement>('[data-testid=wb-tab-add]')!.click();
    await settle();
    expect(host.querySelectorAll('[role=tab]')).toHaveLength(3);
    expect(location.pathname).toBe('/');
    expect(host.querySelectorAll('[role=tab]')[1].getAttribute('aria-selected')).toBe('true');
  });

  it('shows the global menu’s "…" first in the top bar while the menu has entries, and the menu on a click', async () => {
    const button = host.querySelector<HTMLButtonElement>('[data-testid=wb-global-menu]')!;
    expect(host.querySelector('[data-testid=wb-top-bar] button')).toBe(button);
    expect(button.hidden).toBe(true);
    const entry = ui.registerMenuItem('workbench/global', { command: 'test.global', title: 'Something global' });
    expect(button.hidden).toBe(false);
    button.click();
    const options = [...host.querySelectorAll<HTMLElement>('[role=option]')];
    expect(options.map((option) => option.textContent)).toEqual(['Something global']);
    entry.dispose();
    expect(button.hidden).toBe(true);
  });
});
