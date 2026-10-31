// @vitest-environment jsdom
// Tests for offer.ts: what a click offers (offerFilters, the command filters.offer): "Filter" and "Exclude" per
// candidate of a field the widget filters by, at the click, and for a time or a number the comparisons of its type;
// the choice made a pill by the widget's /pill and added at once; none on Escape or a failed /pill. The request of
// /pill (fetchPill).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryHost, type QueryState } from '../../hosts/query/query';
import { FILTERS_STATE, chipsState, type FilterChip } from './chips';
import { QuickInput } from '../../hosts/ui/quick-input/quick-input';
import { fetchPill, offerFilters } from './offer';

let host: HTMLElement;
let quickInput: QuickInput;
let query: QueryHost;
let chips: QueryState<readonly FilterChip[]>;
/** The URLs fetched; each `/pill` answers a key naming its field, op and value, unless `refused` says otherwise. */
let fetched: URL[];
let refused: Response | undefined;

const source = { dataUrl: '/p/shop/api/3', filterable: ['status', 'instance'] };
const pill = (field: string, op: string, value: string) => ({ kind: 'pill', key: `key:${field}:${op}:${value}` });

/** The quick pick's options as their icon and label read ("Filter status = 500", "Exclude status = 500"). */
const choices = () =>
  [...host.querySelectorAll<HTMLElement>('.d-workbench__quick-pick[aria-label="Filter"] [role=option]')].map((el) =>
    `${el.querySelector('[role=img]')?.getAttribute('aria-label') ?? ''} ${el.textContent?.trim()}`.trim(),
  );
/** Clicks the option `label` reads as ("Exclude status = 500"). */
const choose = (label: string) => {
  const options = [...host.querySelectorAll<HTMLElement>('.d-workbench__quick-pick[aria-label="Filter"] [role=option]')];
  options[choices().indexOf(label)].click();
};

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  query = new QueryHost();
  chips = query.registerState(FILTERS_STATE, chipsState);
  query.load();
  host = document.body.appendChild(document.createElement('div'));
  quickInput = new QuickInput(host);
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
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

describe('offerFilters', () => {
  it('offers to filter by and to exclude each candidate in order, at the click; choosing one adds its pill at once', async () => {
    const done = offerFilters(quickInput, chips, { x: 10, y: 20 }, [{ fieldId: 'status', value: '500' }, { fieldId: 'instance', value: 'web-1' }], source);
    expect(choices()).toEqual(['Filter status = 500', 'Exclude status = 500', 'Filter instance = web-1', 'Exclude instance = web-1']);
    expect(host.querySelector<HTMLElement>('.d-workbench__quick-pick')!.style.left).toBe('10px');
    choose('Exclude instance = web-1');
    await done;

    expect(choices()).toEqual([]);
    expect(chips.get()).toEqual([pill('instance', 'ne', 'web-1')]);
    expect(fetched.at(-1)?.pathname).toBe('/p/shop/api/3/pill');
    expect(Object.fromEntries(fetched.at(-1)!.searchParams)).toEqual({ field: 'instance', op: 'ne', value: 'web-1' });
  });

  it('offers ≥ and ≤ a time first, then the other ops of its type, and sends the type along', async () => {
    const at = '2026-10-31T10:00:00.000Z';
    const done = offerFilters(quickInput, chips, { x: 10, y: 20 }, [{ fieldId: 'timestamp', value: at, type: 'DateTime' }], { ...source, filterable: ['timestamp'] });
    expect(choices()).toEqual([
      `At least timestamp ≥ ${at}`,
      `At most timestamp ≤ ${at}`,
      `Above timestamp > ${at}`,
      `Below timestamp < ${at}`,
      `Filter timestamp = ${at}`,
      `Exclude timestamp = ${at}`,
    ]);
    choose(`At most timestamp ≤ ${at}`);
    await done;

    expect(chips.get()).toEqual([pill('timestamp', 'le', at)]);
    expect(Object.fromEntries(fetched.at(-1)!.searchParams)).toEqual({ field: 'timestamp', op: 'le', value: at, type: 'DateTime' });
  });

  it('offers only the fields the widget filters by, and nothing without one', async () => {
    void offerFilters(quickInput, chips, { x: 10, y: 20 }, [{ fieldId: 'status', value: '500' }, { fieldId: 'cnt', value: '3' }], source);
    expect(choices()).toEqual(['Filter status = 500', 'Exclude status = 500']);
    await offerFilters(quickInput, chips, { x: 10, y: 20 }, [{ fieldId: 'cnt', value: '3' }], source);
    await offerFilters(quickInput, chips, { x: 10, y: 20 }, [], source);
    expect(choices()).toEqual(['Filter status = 500', 'Exclude status = 500']);
  });

  it('adds no pill when the widget’s /pill fails', async () => {
    const failing = vi.spyOn(console, 'error').mockImplementation(() => {});
    refused = new Response('"status" cannot filter this chart\'s table', { status: 422 });
    const done = offerFilters(quickInput, chips, { x: 10, y: 20 }, [{ fieldId: 'status', value: '500' }], source);
    choose('Filter status = 500');
    await done;

    expect(chips.get()).toEqual([]);
    expect(failing).toHaveBeenCalled();
    failing.mockRestore();
  });

  it('adds nothing when the viewer closes the quick pick', async () => {
    const done = offerFilters(quickInput, chips, { x: 10, y: 20 }, [{ fieldId: 'status', value: '500' }], source);
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await done;

    expect([choices(), chips.get(), fetched]).toEqual([[], [], []]);
  });
});

describe('fetchPill', () => {
  it('asks <dataUrl>/pill for the field, op and value, gives the key it answers, and rejects with the server’s answer', async () => {
    expect(await fetchPill('/p/shop/api/3', { fieldId: 'host', op: 'eq', value: 'a b' })).toEqual({ key: 'key:host:eq:a b' });
    refused = new Response('no field host', { status: 422 });
    await expect(fetchPill('/p/shop/api/3', { fieldId: 'host', op: 'eq', value: 'a' })).rejects.toThrow('422: no field host');
  });
});
