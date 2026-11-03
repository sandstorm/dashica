// @vitest-environment jsdom
// Tests for offer.ts: what a click offers (filterMenuProvider): per data point of a field the widget filters by, one
// item per op of its type with its own sign and icon, for a time or a number the comparisons too, for two or more one
// that filters by all at once, each running `filters.addPill` with the widget's dataUrl; none for other fields or a
// widget without filterable ones. The pills added (addPill), none on a failed /pill, which rejects with the server's
// message. The request of /pill (fetchPill).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { QueryHost } from '../../hosts/query/query';
import type { DataPoint, DataPointMenuItem } from '../../hosts/widgets/widgets';
import { FILTERS } from './chips';
import { addPill, fetchPill, filterMenuProvider } from './offer';

let query: QueryHost;
/** The URLs fetched; each `/pill` answers a key naming its field, op and value, unless `refused` says otherwise. */
let fetched: URL[];
let refused: Response | undefined;

const chart = { type: 'barVertical', props: {}, dataUrl: '/p/shop/api/3', filterable: ['status', 'instance', 'timestamp'] } as unknown as WidgetNode;
const pill = (field: string, op: string, value: string) => ({ kind: 'pill', key: `key:${field}:${op}:${value}` });

/** The items `filterMenuProvider` offers for `dataPoints` of `widget`, as their icon and label read ("Filter status = 500"). */
const offered = (dataPoints: readonly DataPoint[], widget: WidgetNode = chart) => {
  const items = filterMenuProvider.provideDataPointMenuItems({ widget, url: (path) => path, lastResult: undefined }, dataPoints) as readonly DataPointMenuItem[];
  return items.map((item) => `${item.icon?.label} ${item.label}`);
};

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  query = new QueryHost();
  // declared as by the filters extension
  query.declare(FILTERS);
  query.load();
  fetched = [];
  refused = undefined;
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, location.href);
    fetched.push(url);
    if (refused) return refused;
    const [field, op, value] = ['field', 'op', 'value'].map((key) => url.searchParams.get(key) ?? '');
    return Response.json({ key: `key:${field}:${op}:${value}`, label: `${field} ${op} ${value}` });
  });
});

afterEach(() => {
  query.dispose();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('filterMenuProvider', () => {
  it('offers to filter by and to exclude each data point in order, each running filters.addPill with the widget’s dataUrl', () => {
    expect(offered([{ field: 'status', value: '500' }, { field: 'instance', value: 'web-1' }])).toEqual([
      'Filter status = 500',
      'Exclude status ≠ 500',
      'Filter instance = web-1',
      'Exclude instance ≠ web-1',
      'Filter status = 500 AND instance = web-1',
    ]);
    const items = filterMenuProvider.provideDataPointMenuItems({ widget: chart, url: (path) => path, lastResult: undefined }, [{ field: 'status', value: '500' }]);
    expect(items).toMatchObject([
      { command: 'filters.addPill', arguments: ['/p/shop/api/3', [{ field: 'status', op: 'eq', value: '500' }]] },
      { command: 'filters.addPill', arguments: ['/p/shop/api/3', [{ field: 'status', op: 'ne', value: '500' }]] },
    ]);
  });

  it('offers to filter by all data points at once, as the last item', () => {
    const items = filterMenuProvider.provideDataPointMenuItems({ widget: chart, url: (path) => path, lastResult: undefined }, [
      { field: 'instance', value: 'shop_a' },
      { field: 'status', value: 'failed' },
    ]) as readonly DataPointMenuItem[];
    expect(items.at(-1)).toMatchObject({
      label: 'instance = shop_a AND status = failed',
      command: 'filters.addPill',
      arguments: [
        '/p/shop/api/3',
        [
          { field: 'instance', op: 'eq', value: 'shop_a' },
          { field: 'status', op: 'eq', value: 'failed' },
        ],
      ],
    });
  });

  it('offers ≥ and ≤ a time first, then the other ops of its type', () => {
    const at = '2026-10-31T10:00:00.000Z';
    expect(offered([{ field: 'timestamp', value: at, type: 'DateTime' }])).toEqual([
      `At least timestamp ≥ ${at}`,
      `At most timestamp ≤ ${at}`,
      `Above timestamp > ${at}`,
      `Below timestamp < ${at}`,
      `Filter timestamp = ${at}`,
      `Exclude timestamp ≠ ${at}`,
    ]);
  });

  it('offers only the fields the widget filters by, and nothing for a widget without such fields', () => {
    expect(offered([{ field: 'status', value: '500' }, { field: 'cnt', value: '3' }])).toEqual(['Filter status = 500', 'Exclude status ≠ 500']);
    expect(offered([{ field: 'cnt', value: '3' }])).toEqual([]);
    expect(offered([{ field: 'status', value: '500' }], { ...chart, filterable: undefined } as WidgetNode)).toEqual([]);
    expect(offered([{ field: 'status', value: '500' }], { type: 'markdown', props: {} } as unknown as WidgetNode)).toEqual([]);
  });
});

describe('addPill', () => {
  it('adds the pill the widget’s /pill makes to the chips', async () => {
    await addPill(query, '/p/shop/api/3', [{ field: 'instance', op: 'ne', value: 'web-1' }]);

    expect(query.get(FILTERS)).toEqual([pill('instance', 'ne', 'web-1')]);
    expect(fetched.at(-1)?.pathname).toBe('/p/shop/api/3/pill');
    expect(Object.fromEntries(fetched.at(-1)!.searchParams)).toEqual({ field: 'instance', op: 'ne', value: 'web-1' });
  });

  it('adds all the pills at once', async () => {
    await addPill(query, '/p/shop/api/3', [
      { field: 'instance', op: 'eq', value: 'shop_a' },
      { field: 'status', op: 'eq', value: 'failed' },
    ]);

    expect(query.get(FILTERS)).toEqual([pill('instance', 'eq', 'shop_a'), pill('status', 'eq', 'failed')]);
  });

  it('adds none when the widget’s /pill fails, rejecting with the server’s message', async () => {
    refused = new Response('"status" cannot filter this chart\'s table', { status: 422 });
    await expect(addPill(query, '/p/shop/api/3', [{ field: 'status', op: 'eq', value: '500' }])).rejects.toThrow('422: "status" cannot filter this chart\'s table');
    expect(query.get(FILTERS)).toEqual([]);
  });
});

describe('fetchPill', () => {
  it('asks <dataUrl>/pill for the field, op and value, gives the key it answers, and rejects with the server’s answer', async () => {
    expect(await fetchPill('/p/shop/api/3', { field: 'host', op: 'eq', value: 'a b' })).toEqual({ key: 'key:host:eq:a b' });
    refused = new Response('no field host', { status: 422 });
    await expect(fetchPill('/p/shop/api/3', { field: 'host', op: 'eq', value: 'a' })).rejects.toThrow('422: no field host');
  });
});
