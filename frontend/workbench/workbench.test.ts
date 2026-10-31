// @vitest-environment jsdom
// Tests for workbench.ts: the title bar's controls showing the active tab's query state after a switch of tabs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../core/disposable/disposable';
import { dashboardPage } from '../extensions/dashboard-page/dashboard-page';
import { refresh } from '../extensions/refresh/refresh';
import { timeRange } from '../extensions/time-range/time-range';
import { settle } from '../hosts/widgets/widgets-testing';
import { createWorkbench } from './workbench';

let workbench: Disposable;
let host: HTMLElement;

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
  workbench = createWorkbench(host, { extensions: [dashboardPage, timeRange, refresh], workbench: { menu: [] } });
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
  it('shows the active tab’s time range and auto refresh in the title bar, after each switch', async () => {
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
});
