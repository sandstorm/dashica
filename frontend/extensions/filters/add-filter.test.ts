// @vitest-environment jsdom
// Tests for add-filter.ts: the page's filterable tables (filterableTables), the chart that makes a pill again
// (fieldSource), "add filter" through table, field, operator (of the field's type) and value to the pill of the
// field's chart (addFilter), a time's value in an input box at the edge of the time range (askValue), the value's
// quick pick asking the server as the text changes (pickValue), and the request of /values (fetchValues).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { QueryHost, type QueryState } from '../../hosts/query/query';
import { FILTERS_STATE, chipsState, type FilterChip } from './chips';
import { TIME_STATE, presetRange, timeState, type TimeRange } from '../time-library/time-state';
import { QuickInput } from '../../hosts/ui/quick-input/quick-input';
import { addFilter, askValue, fetchValues, fieldSource, filterableTables, pickValue } from './add-filter';
import { OP_ICONS } from './ops';

const chart = (dataUrl: string, table: string | undefined, filterable: string[], connection = 'default') =>
  ({ type: 'barVertical', props: {}, dataUrl, filterable, table, connection }) as unknown as WidgetNode;

const byHost = chart('/p/shop/api/1', 'default.http_logs', ['host', 'status', 'timestamp']);
const byPath = chart('/p/shop/api/2', 'default.http_logs', ['path', 'host']);
const audit = chart('/p/shop/api/3', 'audit', ['action'], 'logs');
const grid = { type: 'grid', props: {}, children: { a: byPath, b: audit } } as unknown as WidgetNode;

let host: HTMLElement;
let anchor: HTMLButtonElement;
let quickInput: QuickInput;
let query: QueryHost;
let chips: QueryState<readonly FilterChip[]>;
/** The URLs fetched, and what `/values` answers (by `search`; the type by field, else `String`). */
let fetched: URL[];
let values: (search: string) => string[];
const types: Record<string, string> = { timestamp: 'DateTime' };
/** The resolved time range `/values` answers in its header. */
const from = Date.UTC(2026, 9, 31, 9, 0, 0);
const to = Date.UTC(2026, 9, 31, 10, 0, 0);

const options = () => [...host.querySelectorAll<HTMLElement>('[role=option]')];
const field = () => host.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;
const enter = () => field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
const type = (text: string) => {
  field().value = text;
  field().dispatchEvent(new Event('input', { bubbles: true }));
};
/** Waits until the box shows `labels`, then picks the first with Enter. */
async function pick(...labels: string[]): Promise<void> {
  await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual(labels));
  enter();
}

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  query = new QueryHost();
  chips = query.registerState(FILTERS_STATE, chipsState);
  query.registerState(TIME_STATE, timeState);
  query.load();
  host = document.body.appendChild(document.createElement('div'));
  anchor = host.appendChild(document.createElement('button'));
  quickInput = new QuickInput(host);
  fetched = [];
  values = () => [];
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, location.href);
    fetched.push(url);
    const args = url.searchParams;
    if (url.pathname.endsWith('/values')) {
      const answer = { type: types[args.get('field') ?? ''] ?? 'String', values: values(args.get('search') ?? '') };
      return new Response(JSON.stringify(answer), { headers: { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from, to }) } });
    }
    return new Response(JSON.stringify({ key: `key:${args.get('field')}:${args.get('op')}:${args.get('value')}`, label: `${args.get('field')} ${args.get('op')} ${args.get('value')}` }));
  });
});

afterEach(() => {
  query.dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

describe('filterableTables', () => {
  it('is each table with its fields once, each with the first chart naming it, children included', () => {
    const tables = filterableTables([byHost, chart('/p/shop/api/9', undefined, []), grid]);

    expect(tables.map((t) => [t.connection, t.table, t.fields.map((f) => `${f.field}@${f.widget.dataUrl}`)])).toEqual([
      ['default', 'default.http_logs', ['host@/p/shop/api/1', 'status@/p/shop/api/1', 'timestamp@/p/shop/api/1', 'path@/p/shop/api/2']],
      ['logs', 'audit', ['action@/p/shop/api/3']],
    ]);
  });
});

describe('fieldSource', () => {
  const tables = filterableTables([byHost, grid]);

  it('is the first chart naming the field on the table of that connection', () => {
    expect(fieldSource(tables, { connection: 'default', table: 'default.http_logs', field: 'path' })).toBe(byPath);
    expect(fieldSource(tables, { connection: 'default', table: 'default.http_logs', field: 'host' })).toBe(byHost);
  });

  it('is none for a field no chart filters by, or the same table on another connection', () => {
    expect(fieldSource(tables, { connection: 'default', table: 'default.http_logs', field: 'action' })).toBeUndefined();
    expect(fieldSource(tables, { connection: 'logs', table: 'default.http_logs', field: 'host' })).toBeUndefined();
  });
});

describe('addFilter', () => {
  it('asks table, field, operator and value, and adds the pill of the field’s chart', async () => {
    values = (search) => ['admin', 'login'].filter((v) => v.includes(search));
    query.state<TimeRange>(TIME_STATE)!.set(presetRange('1h'));
    const done = addFilter(quickInput, query, chips, filterableTables([byHost, audit]), anchor);

    await pick('default.http_logs default', 'audit logs');
    await pick('host', 'status', 'timestamp');
    await pick('host = …', 'host ≠ …');
    await pick('admin', 'login');
    await done;

    expect(chips.get()).toEqual([{ kind: 'pill', key: 'key:host:eq:admin' }]);
    // asked once for the type and the first values, before the operator
    const asked = fetched.filter((url) => url.pathname === '/p/shop/api/1/values');
    expect(asked.map((url) => [url.searchParams.get('field'), url.searchParams.get('search'), url.searchParams.get('time')])).toEqual([['host', '', '1h']]);
    expect(fetched.at(-1)!.pathname).toBe('/p/shop/api/1/pill');
    expect(fetched.at(-1)!.searchParams.get('type')).toBe('String');
  });

  it('offers a time’s operators, ≥ and ≤ first, and asks its value in an input box at the time range’s edge', async () => {
    const done = addFilter(quickInput, query, chips, filterableTables([byHost]), anchor);

    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual(['host', 'status', 'timestamp']));
    options()[2].click();
    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual(['timestamp ≥ …', 'timestamp ≤ …', 'timestamp > …', 'timestamp < …', 'timestamp = …', 'timestamp ≠ …']));
    options()[1].click();
    await vi.waitFor(() => expect(field().value).toBe('2026-10-31T10:00:00.000Z'));
    field().value = '2026-10-31T09:30:00Z';
    enter();
    await done;

    expect(chips.get()).toEqual([{ kind: 'pill', key: 'key:timestamp:le:2026-10-31T09:30:00Z' }]);
    expect(fetched.at(-1)!.searchParams.get('type')).toBe('DateTime');
  });

  it('shows the operators with the icons of a chart click (OP_ICONS)', async () => {
    void addFilter(quickInput, query, chips, filterableTables([audit]), anchor);

    await pick('action');
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    expect(options().map((o) => o.querySelector('[role=img]')?.innerHTML)).toEqual([OP_ICONS.eq.svg, OP_ICONS.ne.svg]);
    expect(options().map((o) => o.querySelector('[role=img]')?.getAttribute('aria-label'))).toEqual([OP_ICONS.eq.label, OP_ICONS.ne.label]);
  });

  it('asks no table when the page has one, and adds nothing on Escape', async () => {
    const done = addFilter(quickInput, query, chips, filterableTables([audit]), anchor);

    await pick('action');
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await done;

    expect(chips.get()).toEqual([]);
  });
});

describe('askValue', () => {
  const known = (type: string) => ({ type, values: ['x'], timeRange: { from, to } });
  const load = async () => ({ type: 'String', values: [] });

  it('fills in the time range’s start for ≥ and its end for ≤, a day as its date', async () => {
    void askValue(quickInput, anchor, 'timestamp ≥', 'ge', known('Nullable(DateTime64(3))'), load);
    await vi.waitFor(() => expect(field().value).toBe('2026-10-31T09:00:00.000Z'));
    void askValue(quickInput, anchor, 'day ≤', 'le', known('Date'), load);
    await vi.waitFor(() => expect(field().value).toBe('2026-10-31'));
  });

  it('offers the values known for anything else, without asking again', async () => {
    const asked: string[] = [];
    void askValue(quickInput, anchor, 'host =', 'eq', known('String'), async (search) => (asked.push(search), { type: 'String', values: [] }));
    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual(['x']));
    expect(asked).toEqual([]);
  });
});

describe('pickValue', () => {
  it('asks again as the text rests, offers the typed text first, and resolves with the value chosen', async () => {
    const searches: string[] = [];
    const done = pickValue(quickInput, anchor, 'host =', async (search) => (searches.push(search), ['shop-1', 'shop-2', ''].filter((v) => v.includes(search))));

    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual(['shop-1', 'shop-2', '(empty)']));
    type('shop-');
    await vi.waitFor(() => expect(searches).toEqual(['', 'shop-']));
    await pick('shop- as typed', 'shop-1', 'shop-2');

    expect(await done).toBe('shop-');
  });

  it('shows the message of a failed answer', async () => {
    void pickValue(quickInput, anchor, 'host =', async () => {
      throw new Error('500: clickhouse query');
    });

    await vi.waitFor(() => expect(host.textContent).toContain('500: clickhouse query'));
  });
});

describe('fetchValues', () => {
  it('asks <dataUrl>/values with the query state, the field and the search', async () => {
    values = () => ['a'];

    expect(await fetchValues('/p/shop/api/1', 'host', 'sh', new URLSearchParams({ time: '1h', f: 'k' }))).toEqual({ type: 'String', values: ['a'], timeRange: { from, to } });
    expect(fetched[0].pathname + fetched[0].search).toBe('/p/shop/api/1/values?time=1h&f=k&field=host&search=sh');
  });
});
