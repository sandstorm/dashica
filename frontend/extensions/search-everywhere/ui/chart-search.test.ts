// @vitest-environment jsdom
// Tests for chartSearch: the label of a chart, the order of the results, where a result goes (also in a new tab).
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkbenchJson } from '../../../generated/zz_generated.dashica';
import type { SearchItem, SearchProvider } from '../../../hosts/ui/ui';
import { chartSearch } from './chart-search';

const workbench: WorkbenchJson = {
  menu: [
    {
      title: 'Shop',
      entries: [
        { title: 'Orders', url: '/p/orders', outline: [{ id: '1', title: 'Requests', group: '' }] },
        {
          title: 'Checkout',
          url: '/p/checkout',
          outline: [
            { id: '1', title: 'Requests', group: '' },
            { id: 'slow', title: 'Slow requests', group: 'Details' },
          ],
        },
      ],
    },
  ],
};

let navigated: string[];
let provider: SearchProvider;
/** The active tab's URL. */
let shown: string;

beforeEach(() => {
  navigated = [];
  shown = '/p/checkout?time=1h';
  provider = chartSearch({
    workbench,
    get activeTab() {
      return { id: '1', url: shown, title: 'Checkout' };
    },
    navigate: async (url, options) => void navigated.push(options?.newTab ? `${url} (new tab)` : url),
  });
});

/** What the provider gives for `query`: a list, as it answers at once. */
const items = (query: string) => provider.provideItems(query, undefined as never) as readonly SearchItem[];
const labels = (query: string) => items(query).map((item) => item.label);

describe('chartSearch', () => {
  it('names a chart by its page, its group and its title', () => {
    expect(labels('')).toEqual(['Checkout › Requests', 'Checkout › Details › Slow requests', 'Orders › Requests']);
  });

  it('puts the charts of the active tab’s page first, then the best matches', () => {
    expect(labels('requests')).toEqual(['Checkout › Requests', 'Checkout › Details › Slow requests', 'Orders › Requests']);
    shown = '/p/orders';
    expect(labels('requests')).toEqual(['Orders › Requests', 'Checkout › Requests', 'Checkout › Details › Slow requests']);
  });

  it('matches across the parts and marks what matched', () => {
    const [item] = items('details slow');
    expect(item.label).toBe('Checkout › Details › Slow requests');
    expect(item.highlights?.label).not.toEqual([]);
  });

  it('opens the page of the picked chart at the chart', async () => {
    const [item] = items('slow');
    await item.accept();
    await item.accept({ newTab: true });
    expect(navigated).toEqual(['/p/checkout#w=slow', '/p/checkout#w=slow (new tab)']);
  });
});
