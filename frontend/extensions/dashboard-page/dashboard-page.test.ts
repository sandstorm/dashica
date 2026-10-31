// @vitest-environment jsdom
// Tests for dashboard-page.ts: the widgets one below the other with their tab's query state, taken down with the page;
// a link to a chart.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { Memento } from '../../hosts/extension-host/extension-host';
import { PageHost } from '../../hosts/page/page';
import { widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { collapsible } from '../collapsible/collapsible';
import { markdown } from '../markdown/markdown';
import { schemaTable } from '../schema-table/schema-table';
import { dashboardPage } from './dashboard-page';

let testbed: ReturnType<typeof widgetTestbed>;
let content: HTMLElement;
let page: PageHost | undefined;
let scrolledTo: Element[];

/** A page with a chart in a closed group inside a closed group. */
const billing: PageJson = {
  kind: 'dashboard',
  title: 'Billing',
  filterBar: false,
  filterButtons: [],
  widgets: [
    { type: 'schemaTable', props: { table: 'invoices' }, dataUrl: '/p/billing/api/1' },
    {
      type: 'collapsibleGroup',
      props: { title: 'Details' },
      children: { '0': { type: 'collapsibleGroup', props: { title: 'Slow' }, children: { '0': { type: 'schemaTable', props: { table: 'payments' }, dataUrl: '/p/billing/api/slow_payments' } } } },
    },
  ],
};

const shop: PageJson = {
  kind: 'dashboard',
  title: 'Shop',
  filterBar: false,
  filterButtons: [],
  widgets: [
    { type: 'markdown', props: { html: '<p>Orders</p>' } },
    { type: 'markdown', props: { html: '<p>Payments</p>' } },
  ],
};

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.serveText('/p/shop/page.json', JSON.stringify(shop));
  testbed.serveText('/p/billing/page.json', JSON.stringify(billing));
  scrolledTo = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolledTo.push(this);
  };
  content = document.body.appendChild(document.createElement('main'));
  testbed.activate(markdown, collapsible, schemaTable);
});

/** The page host at `url`, the dashboard page's renderer registered, started. */
async function start(url: string): Promise<PageHost> {
  history.replaceState(null, '', url);
  page = new PageHost(window, { menu: [] }, content, { get: (_key: string, defaultValue?: unknown) => defaultValue, update: async () => {} } as Memento);
  dashboardPage.activate({ page, widgets: testbed.widgets, subscriptions: [] } as never);
  await page.start();
  return page;
}

afterEach(() => {
  page?.dispose();
  page = undefined;
  testbed.dispose();
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

/** An `animationend` of the animation `name`, bubbling as the browser's does. */
const animationEnd = (name: string) => Object.assign(new Event('animationend', { bubbles: true }), { animationName: name });

/** The highlighted widgets. */
const linked = () => [...content.querySelectorAll('[data-data-url]')].filter((widget) => widget.classList.contains('d-dashboard-page__linked'));

describe('dashboardPage', () => {
  it('renders the widgets one below the other', async () => {
    await start('/p/shop');
    expect([...content.querySelectorAll('.d-markdown')].map((w) => w.textContent)).toEqual(['Orders', 'Payments']);
  });

  it('renders the widgets with its tab’s query state', async () => {
    const states: unknown[] = [];
    testbed.widgets.registerWidget('stats', (_el, _widget, ctx) => (states.push(ctx.state), { dispose() {} }));
    testbed.serveText('/p/stats/page.json', JSON.stringify({ ...shop, widgets: [{ type: 'stats', props: {}, dataUrl: '/p/stats/api/1' }] }));
    const shown = await start('/p/stats?f=host:eq:a');
    expect(states).toEqual([shown.activeQuery]);
    expect(shown.activeQuery.filters.chips).toEqual([{ kind: 'field', fieldId: 'host', op: 'eq', value: 'a' }]);
  });

  it('takes the widgets down with the page', async () => {
    (await start('/p/shop')).dispose();
    expect(content.children.length).toBe(0);
  });

  it('opens the groups around the chart a link names, scrolls it into view and highlights it for a moment', async () => {
    await start('/p/billing#w=slow_payments');
    const chart = content.querySelector<HTMLElement>('[data-data-url="/p/billing/api/slow_payments"]')!;
    expect([...content.querySelectorAll('details')].map((group) => group.open)).toEqual([true, true]);
    expect(scrolledTo).toEqual([chart]);
    expect(linked()).toEqual([chart]);
    chart.firstElementChild!.dispatchEvent(animationEnd('d-spinner'));
    expect(linked()).toEqual([chart]);
    chart.dispatchEvent(animationEnd('d-dashboard-page-linked'));
    expect(linked()).toEqual([]);
  });

  it('goes to a chart of the page shown on a hash change, without loading the page again', async () => {
    const shown = await start('/p/billing');
    expect(scrolledTo).toEqual([]);
    await shown.navigate('/p/billing#w=1');
    expect(linked()).toEqual([content.querySelector('[data-data-url="/p/billing/api/1"]')]);
    expect(testbed.requests.filter((url) => url.pathname.endsWith('/page.json')).length).toBe(1);
  });

  it('leaves the page as it is for a link to a chart it lacks', async () => {
    await start('/p/billing#w=99');
    expect(scrolledTo).toEqual([]);
    expect([...content.querySelectorAll('details')].map((group) => group.open)).toEqual([false, false]);
  });
});
