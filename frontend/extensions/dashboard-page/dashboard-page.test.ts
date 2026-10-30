// @vitest-environment jsdom
// Tests for dashboard-page.ts: the widgets one below the other, taken down with the page; a link to a chart.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageJson } from '../../generated/zz_generated.dashica';
import { PageHost } from '../../hosts/page/page';
import { widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { collapsible } from '../collapsible/collapsible';
import { markdown } from '../markdown/markdown';
import { schemaTable } from '../schema-table/schema-table';
import { dashboardPage } from './dashboard-page';

let testbed: ReturnType<typeof widgetTestbed>;
let content: HTMLElement;
let page: PageHost;
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
  page = new PageHost(window, { menu: [] }, testbed.query, content);
  testbed.activate(markdown, collapsible, schemaTable);
  dashboardPage.activate({ page, widgets: testbed.widgets, subscriptions: [] } as never);
});

afterEach(() => {
  page.dispose();
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
    await page.start();
    expect([...content.querySelectorAll('.d-markdown')].map((w) => w.textContent)).toEqual(['Orders', 'Payments']);
  });

  it('takes the widgets down with the page', async () => {
    await page.start();
    page.dispose();
    expect(content.children.length).toBe(0);
  });

  it('opens the groups around the chart a link names, scrolls it into view and highlights it for a moment', async () => {
    history.replaceState(null, '', '/p/billing#w=slow_payments');
    await page.start();
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
    history.replaceState(null, '', '/p/billing');
    await page.start();
    expect(scrolledTo).toEqual([]);
    await page.navigate('/p/billing#w=1');
    expect(linked()).toEqual([content.querySelector('[data-data-url="/p/billing/api/1"]')]);
    expect(testbed.requests.filter((url) => url.pathname.endsWith('/page.json')).length).toBe(1);
  });

  it('leaves the page as it is for a link to a chart it lacks', async () => {
    history.replaceState(null, '', '/p/billing#w=99');
    await page.start();
    expect(scrolledTo).toEqual([]);
    expect([...content.querySelectorAll('details')].map((group) => group.open)).toEqual([false, false]);
  });
});
