// @vitest-environment jsdom
// Tests for dashboard-page.ts: the widgets one below the other, taken down with the page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageJson } from '../../generated/zz_generated.dashica';
import { PageHost } from '../../hosts/page/page';
import { widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { markdown } from '../markdown/markdown';
import { dashboardPage } from './dashboard-page';

let testbed: ReturnType<typeof widgetTestbed>;
let content: HTMLElement;
let page: PageHost;

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
  content = document.body.appendChild(document.createElement('main'));
  page = new PageHost(window, { menu: [] }, testbed.query, content);
  testbed.activate(markdown);
  dashboardPage.activate({ page, widgets: testbed.widgets, subscriptions: [] } as never);
});

afterEach(() => {
  page.dispose();
  testbed.dispose();
  vi.unstubAllGlobals();
});

describe('dashboardPage', () => {
  it('renders the widgets one below the other', async () => {
    await page.start();
    expect([...content.querySelectorAll('.markdown-widget')].map((w) => w.textContent)).toEqual(['Orders', 'Payments']);
  });

  it('takes the widgets down with the page', async () => {
    await page.start();
    page.dispose();
    expect(content.children.length).toBe(0);
  });
});
