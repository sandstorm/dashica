// @vitest-environment jsdom
// Tests for add-filter.ts: the page's filterable tables (filterableTables), the chart that makes a pill again
// (fieldSource), "add filter" through table, column or computed field, operator (of its type) and value to the pill of
// its chart (addFilter), the field step's table columns from the schema and computed fields, its advanced "SQL
// condition…" while SQL chips are taken, a time's value in an input box at the edge of the time range (askValue), the
// value's quick pick asking the server as the text changes (pickValue), and the requests of /values, /type and
// /columns (fetchValues, fetchType, fetchColumns).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { QueryHost } from '../../hosts/query/query';
import { FILTERS } from './chips';
import { TIME, presetRange } from '../time-library/time-state';
import { QuickInput } from '../../hosts/ui/quick-input/quick-input';
import { addFilter, askValue, fetchColumns, fetchType, fetchValues, fieldSource, filterableTables, pickValue, type Column } from './add-filter';
import { OP_ICONS } from './ops';

const chart = (dataUrl: string, table: string | undefined, filterable: string[], connection = 'default', computed: string[] = []) =>
  ({ type: 'barVertical', props: {}, dataUrl, filterable, computed, table, connection }) as unknown as WidgetNode;

/** `host` an expression (JSONExtractString), `status` and `timestamp` columns of the table. */
const byHost = chart('/p/shop/api/1', 'default.http_logs', ['host', 'status', 'timestamp'], 'default', ['host']);
const byPath = chart('/p/shop/api/2', 'default.http_logs', ['path', 'host'], 'default', ['host']);
const audit = chart('/p/shop/api/3', 'audit', ['action'], 'logs');
const grid = { type: 'grid', props: {}, children: { a: byPath, b: audit } } as unknown as WidgetNode;

let host: HTMLElement;
let anchor: HTMLButtonElement;
let quickInput: QuickInput;
let query: QueryHost;
/** The URLs fetched, and what `/values` answers (by `search`; the type by field, else `String`; `/type` no values). */
let fetched: URL[];
let values: (search: string) => string[];
const types: Record<string, string> = { timestamp: 'DateTime' };
/** What `<dataUrl>/columns` answers, by the chart's URL; a chart without an entry answers 502. */
let columns: Record<string, Column[]>;
/** The resolved time range `/values` and `/type` answer in their header. */
const from = Date.UTC(2026, 9, 31, 9, 0, 0);
const to = Date.UTC(2026, 9, 31, 10, 0, 0);

const options = () => [...host.querySelectorAll<HTMLElement>('[role=option]')];
const headings = () => [...host.querySelectorAll<HTMLElement>('.d-workbench__quick-pick-heading')].map((h) => h.textContent?.trim());
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
  // sent along from here on, as by the time-range extension
  query.get(TIME);
  query.load();
  host = document.body.appendChild(document.createElement('div'));
  anchor = host.appendChild(document.createElement('button'));
  quickInput = new QuickInput(host);
  fetched = [];
  values = () => [];
  columns = {
    '/p/shop/api/1': [
      { name: 'timestamp', type: 'DateTime' },
      { name: 'status', type: 'UInt16' },
      { name: 'user', type: 'String' },
    ],
    '/p/shop/api/3': [{ name: 'action', type: 'LowCardinality(String)' }],
  };
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, location.href);
    fetched.push(url);
    const args = url.searchParams;
    if (url.pathname.endsWith('/columns')) {
      const shown = columns[url.pathname.slice(0, -'/columns'.length)];
      if (!shown) return new Response('query system.tables: unreachable', { status: 502 });
      // the schema's answer has more than name and type
      const answer = { columns: shown.map((c) => ({ ...c, defaultKind: '', comment: '' })) };
      return new Response(JSON.stringify(answer), { headers: { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from, to }) } });
    }
    if (url.pathname.endsWith('/values') || url.pathname.endsWith('/type')) {
      const answer = { type: types[args.get('field') ?? ''] ?? 'String', values: url.pathname.endsWith('/type') ? [] : values(args.get('search') ?? '') };
      return new Response(JSON.stringify(answer), { headers: { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from, to }) } });
    }
    const by = args.get('field') ?? `column ${args.get('column')}`;
    return new Response(JSON.stringify({ key: `key:${by}:${args.get('op')}:${args.get('value')}`, label: `${by} ${args.get('op')} ${args.get('value')}` }));
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

    expect(tables.map((t) => [t.connection, t.table, t.fields.map((f) => `${f.field}@${f.widget.dataUrl}${f.computed ? ' computed' : ''}`)])).toEqual([
      ['default', 'default.http_logs', ['host@/p/shop/api/1 computed', 'status@/p/shop/api/1', 'timestamp@/p/shop/api/1', 'path@/p/shop/api/2']],
      ['logs', 'audit', ['action@/p/shop/api/3']],
    ]);
  });

  it('has a table read by a chart without filterable fields, served by its first chart', () => {
    const stats = chart('/p/shop/api/7', 'default.payments', []);
    const tables = filterableTables([stats, chart('/p/shop/api/8', 'default.payments', ['shop'])]);

    expect(tables.map((t) => [t.table, t.widget.dataUrl, t.fields.map((f) => f.field)])).toEqual([['default.payments', '/p/shop/api/7', ['shop']]]);
  });
});

describe('fieldSource', () => {
  const tables = filterableTables([byHost, grid]);

  it('is the first chart naming the field on the table of that connection', () => {
    expect(fieldSource(tables, { connection: 'default', table: 'default.http_logs', field: 'path' })).toBe(byPath);
    expect(fieldSource(tables, { connection: 'default', table: 'default.http_logs', field: 'host' })).toBe(byHost);
  });

  it('is the table’s first chart for a column', () => {
    expect(fieldSource(tables, { connection: 'default', table: 'default.http_logs', field: 'user', column: true })).toBe(byHost);
    expect(fieldSource(tables, { connection: 'logs', table: 'default.http_logs', field: 'user', column: true })).toBeUndefined();
  });

  it('is none for a field no chart filters by, or the same table on another connection', () => {
    expect(fieldSource(tables, { connection: 'default', table: 'default.http_logs', field: 'action' })).toBeUndefined();
    expect(fieldSource(tables, { connection: 'logs', table: 'default.http_logs', field: 'host' })).toBeUndefined();
  });
});

describe('addFilter', () => {
  it('asks table, computed field, operator and value, and adds the pill of the field’s chart', async () => {
    values = (search) => ['admin', 'login'].filter((v) => v.includes(search));
    query.set(TIME, presetRange('1h'));
    const done = addFilter(quickInput, query, filterableTables([byHost, audit]), anchor, false);

    await pick('default.http_logs default', 'audit logs');
    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toContain('host'));
    options().find((o) => o.textContent?.trim() === 'host')!.click();
    await pick('host = …', 'host ≠ …');
    await pick('admin', 'login');
    await done;

    expect(query.get(FILTERS)).toEqual([{ kind: 'pill', key: 'key:host:eq:admin' }]);
    // the type before the operator, the values for the value step
    const asked = fetched.filter((url) => url.pathname.startsWith('/p/shop/api/1/') && !url.pathname.endsWith('/pill'));
    expect(asked.map((url) => [url.pathname, url.searchParams.get('field'), url.searchParams.get('search'), url.searchParams.get('time')])).toEqual([
      ['/p/shop/api/1/columns', null, null, '1h'],
      ['/p/shop/api/1/type', 'host', null, '1h'],
      ['/p/shop/api/1/values', 'host', '', '1h'],
    ]);
    expect(fetched.at(-1)!.pathname).toBe('/p/shop/api/1/pill');
    expect(fetched.at(-1)!.searchParams.has('type')).toBe(false);
  });

  it('groups the fields into the table’s columns, from the schema, and the computed fields, each once', async () => {
    void addFilter(quickInput, query, filterableTables([byHost, byPath]), anchor, false);

    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual(['timestamp DateTime', 'status UInt16', 'user String', 'host']));
    expect(headings()).toEqual(['Table columns', 'Computed fields']);
    // `path` is a column of byPath, but not of the table's schema here: only the schema's columns are listed
  });

  it('lists the charts’ plain fields as columns when the schema is not to be had, its message at the heading', async () => {
    columns = {};
    values = () => ['500'];
    const done = addFilter(quickInput, query, filterableTables([byHost]), anchor, false);

    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual(['status', 'timestamp', 'host']));
    expect(headings()).toEqual([expect.stringContaining('502: query system.tables: unreachable'), 'Computed fields']);
    options()[0].click();
    await pick('status = …', 'status ≠ …');
    await pick('500');
    await done;

    // made by its chart as its field, not as a column
    expect(fetched.at(-1)!.searchParams.get('field')).toBe('status');
  });

  it('asks a column’s values and pill by `column`, its type from the schema without /type', async () => {
    values = () => ['bob'];
    const done = addFilter(quickInput, query, filterableTables([byHost]), anchor, false);

    await vi.waitFor(() => expect(options()).toHaveLength(4));
    options()[2].click();
    await pick('user = …', 'user ≠ …');
    await pick('bob');
    await done;

    expect(query.get(FILTERS)).toEqual([{ kind: 'pill', key: 'key:column user:eq:bob' }]);
    expect(fetched.map((url) => url.pathname)).toEqual(['/p/shop/api/1/columns', '/p/shop/api/1/values', '/p/shop/api/1/pill']);
    expect(fetched[1].searchParams.get('column')).toBe('user');
    expect(fetched[2].searchParams.has('type')).toBe(false);
  });

  it('offers a time’s operators, ≥ and ≤ first, and asks its value in an input box at the time range’s edge', async () => {
    const done = addFilter(quickInput, query, filterableTables([byHost]), anchor, false);

    await vi.waitFor(() => expect(options()).toHaveLength(4));
    options()[0].click();
    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual(['timestamp ≥ …', 'timestamp ≤ …', 'timestamp > …', 'timestamp < …', 'timestamp = …', 'timestamp ≠ …']));
    options()[1].click();
    await vi.waitFor(() => expect(field().value).toBe('2026-10-31T10:00:00.000Z'));
    field().value = '2026-10-31T09:30:00Z';
    enter();
    await done;

    expect(query.get(FILTERS)).toEqual([{ kind: 'pill', key: 'key:column timestamp:le:2026-10-31T09:30:00Z' }]);
    expect(fetched.at(-1)!.searchParams.has('type')).toBe(false);
    // a time's values are never asked
    expect(fetched.filter((url) => url.pathname.endsWith('/values'))).toEqual([]);
  });

  it('shows the operators with the icons of a chart click (OP_ICONS)', async () => {
    void addFilter(quickInput, query, filterableTables([audit]), anchor, false);

    await pick('action LowCardinality(String)');
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    expect(options().map((o) => o.querySelector('[role=img]')?.innerHTML)).toEqual([OP_ICONS.eq.svg, OP_ICONS.ne.svg]);
    expect(options().map((o) => o.querySelector('[role=img]')?.getAttribute('aria-label'))).toEqual([OP_ICONS.eq.label, OP_ICONS.ne.label]);
  });

  it('asks no table when the page has one, and adds nothing on Escape', async () => {
    const done = addFilter(quickInput, query, filterableTables([audit]), anchor, false);

    await pick('action LowCardinality(String)');
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await done;

    expect(query.get(FILTERS)).toEqual([]);
  });
});

describe('addFilter with SQL chips taken', () => {
  const input = () => host.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;

  it('ends the table’s pick with "SQL condition…", which asks the condition in an input box and adds a SQL chip', async () => {
    const done = addFilter(quickInput, query, filterableTables([byHost, audit]), anchor, true);

    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual(['default.http_logs default', 'audit logs', expect.stringContaining('SQL condition…')]));
    expect(headings()).toEqual(['Advanced']);
    options()[2].click();
    await vi.waitFor(() => expect(options()).toHaveLength(0));
    input().value = 'duration > 2000';
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await done;

    expect(query.get(FILTERS)).toEqual([{ kind: 'sql', sql: 'duration > 2000' }]);
  });

  it('ends the field’s pick with it on a page of one table, and is the only entry without one', async () => {
    void addFilter(quickInput, query, filterableTables([audit]), anchor, true);
    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual(['action LowCardinality(String)', expect.stringContaining('SQL condition…')]));
    void addFilter(quickInput, query, [], anchor, true);
    await vi.waitFor(() => expect(options().map((o) => o.textContent?.trim())).toEqual([expect.stringContaining('SQL condition…')]));
  });

  it('adds nothing on Escape in the input box', async () => {
    const done = addFilter(quickInput, query, [], anchor, true);
    await vi.waitFor(() => expect(options()).toHaveLength(1));
    options()[0].click();
    await vi.waitFor(() => expect(options()).toHaveLength(0));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await done;

    expect(query.get(FILTERS)).toEqual([]);
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

    expect(await fetchValues('/p/shop/api/1', { field: 'host' }, 'sh', new URLSearchParams({ time: '1h', f: 'k' }))).toEqual({ type: 'String', values: ['a'], timeRange: { from, to } });
    expect(fetched[0].pathname + fetched[0].search).toBe('/p/shop/api/1/values?time=1h&f=k&field=host&search=sh');
  });

  it('asks a column by `column`', async () => {
    await fetchValues('/p/shop/api/1', { field: 'user', column: true }, '', new URLSearchParams({ time: '1h' }));
    expect(fetched[0].search).toBe('?time=1h&column=user&search=');
  });
});

describe('fetchType', () => {
  it('asks <dataUrl>/type with the query state and the field', async () => {
    expect(await fetchType('/p/shop/api/1', { field: 'timestamp' }, new URLSearchParams({ time: '1h', f: 'k' }))).toEqual({ type: 'DateTime', timeRange: { from, to } });
    expect(fetched[0].pathname + fetched[0].search).toBe('/p/shop/api/1/type?time=1h&f=k&field=timestamp');
  });
});

describe('fetchColumns', () => {
  it('asks <dataUrl>/columns with the query state: the names and types, and the resolved time range', async () => {
    expect(await fetchColumns('/p/shop/api/3', new URLSearchParams({ time: '1h' }))).toEqual({
      columns: [{ name: 'action', type: 'LowCardinality(String)' }],
      timeRange: { from, to },
    });
    expect(fetched[0].pathname + fetched[0].search).toBe('/p/shop/api/3/columns?time=1h');
  });

  it('rejects with the server’s message', async () => {
    await expect(fetchColumns('/p/shop/api/9', new URLSearchParams())).rejects.toThrow('502: query system.tables: unreachable');
  });
});
