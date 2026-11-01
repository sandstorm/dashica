// @vitest-environment jsdom
// Tests for add-filter.ts: the page's filterable tables (filterableTables), the chart that makes a pill again
// (fieldSource), "add filter" through table, column or computed field, operator (of its type) and value to the pill of
// its chart (addFilter), the field step's table columns from the schema and computed fields, its advanced "SQL
// condition…" while SQL chips are taken (asked in the SQL editor's input box), a time's value in an input box at the edge of the time range (askValue, busy while a
// type is still to come), the value's quick pick asking the server as the text changes (pickValue), the requests of /values and /fields
// (fetchValues, fetchFields) and the /fields kept per chart and query state (FieldsCache).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { QueryHost } from '../../hosts/query/query';
import { FILTERS } from './chips';
import { TIME, presetRange } from '../time-library/time-state';
import { QuickInput } from '../../hosts/ui/quick-input/quick-input';
import type { UiApi } from '../../hosts/ui/ui';
import { EditorView } from '@codemirror/view';
import { showSqlInputBox } from '../sql-library/sql-editor';
import { FieldsCache, addFilter, askValue, fetchFields, fetchValues, fieldSource, filterableTables, pickValue, typeIn, type AskSql, type Column } from './add-filter';
import { OP_ICONS } from './ops';

const chart = (dataUrl: string, table: string | undefined, filterable: string[], connection = 'default', computed: string[] = []) =>
  ({ type: 'barVertical', props: {}, dataUrl, filterable, computed, table, connection }) as unknown as WidgetNode;

/** `host` an expression (JSONExtractString), `status` and `timestamp` columns of the table. */
const byHost = chart('/p/shop/api/1', 'default.http_logs', ['host', 'status', 'timestamp'], 'default', ['host']);
const byPath = chart('/p/shop/api/2', 'default.http_logs', ['path', 'host'], 'default', ['host']);
const audit = chart('/p/shop/api/3', 'audit', ['action'], 'logs');
const grid = { type: 'grid', props: {}, children: { a: byPath, b: audit } } as unknown as WidgetNode;

let hostContainer: HTMLElement;
let anchorElement: HTMLButtonElement;
let quickInput: QuickInput & Pick<UiApi, 'showErrorMessage'>;
/** The error messages shown (`ui.showErrorMessage`), in order. */
let errors: string[];
let query: QueryHost;
/** The URLs fetched, and what `/values` answers (by `search`). */
let fetched: URL[];
let values: (search: string) => string[];
/** What `<dataUrl>/fields` answers as the table's columns, by the chart's URL; a chart without an entry answers 502. */
let columns: Record<string, Column[]>;
/** What `<dataUrl>/fields` answers as the computed fields, by the chart's URL. */
let computed: Record<string, Column[]>;
/** The resolved time range `/fields` answers in its header. */
const from = Date.UTC(2026, 9, 31, 9, 0, 0);
const to = Date.UTC(2026, 9, 31, 10, 0, 0);

const options = () => [...hostContainer.querySelectorAll<HTMLElement>('[role=option]')];
const headings = () => [...hostContainer.querySelectorAll<HTMLElement>('.d-workbench__quick-pick-heading')].map((headingElement) => headingElement.textContent?.trim());
const field = () => hostContainer.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;
const enter = () => field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
const type = (text: string) => {
  field().value = text;
  field().dispatchEvent(new Event('input', { bubbles: true }));
};
/** Waits until the box shows `labels`, then picks the first with Enter. */
async function pick(...labels: string[]): Promise<void> {
  await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(labels));
  enter();
}

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  query = new QueryHost();
  // sent along, declared as by the time-range extension
  query.declare(TIME);
  // declared as by the filters extension
  query.declare(FILTERS);
  query.load();
  hostContainer = document.body.appendChild(document.createElement('div'));
  anchorElement = hostContainer.appendChild(document.createElement('button'));
  quickInput = Object.assign(new QuickInput(hostContainer), { showErrorMessage: async (message: string) => void errors.push(message) });
  errors = [];
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
  computed = { '/p/shop/api/1': [{ name: 'host', type: 'String' }], '/p/shop/api/2': [{ name: 'host', type: 'String' }] };
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, location.href);
    fetched.push(url);
    const args = url.searchParams;
    if (url.pathname.endsWith('/fields')) {
      const chart = url.pathname.slice(0, -'/fields'.length);
      if (!columns[chart]) return new Response('query system.tables: unreachable', { status: 502 });
      const answer = { columns: columns[chart], computed: computed[chart] ?? [] };
      return new Response(JSON.stringify(answer), { headers: { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from, to }) } });
    }
    if (url.pathname.endsWith('/values')) return new Response(JSON.stringify({ values: values(args.get('search') ?? '') }));
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
    const done = addFilter(quickInput, query, filterableTables([byHost, audit]), anchorElement, new FieldsCache());

    await pick('default.http_logs default', 'audit logs');
    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toContain('host String'));
    options().find((optionElement) => optionElement.textContent?.trim() === 'host String')!.click();
    await pick('host = …', 'host ≠ …');
    await pick('admin', 'login');
    await done;

    expect(query.get(FILTERS)).toEqual([{ kind: 'pill', key: 'key:host:eq:admin' }]);
    // the fields once, with their types, for the field and the operator; the values for the value step
    const asked = fetched.filter((url) => url.pathname.startsWith('/p/shop/api/1/') && !url.pathname.endsWith('/pill'));
    expect(asked.map((url) => [url.pathname, url.searchParams.get('field'), url.searchParams.get('search'), url.searchParams.get('time')])).toEqual([
      ['/p/shop/api/1/fields', null, null, '1h'],
      ['/p/shop/api/1/values', 'host', '', '1h'],
    ]);
    expect(fetched.at(-1)!.pathname).toBe('/p/shop/api/1/pill');
    expect(fetched.at(-1)!.searchParams.has('type')).toBe(false);
  });

  it('adds no pill when the chart’s /pill refuses it, and shows the server’s message', async () => {
    const served = fetch;
    vi.stubGlobal('fetch', async (input: string) =>
      input.includes('/pill?') ? new Response('"host" cannot filter this chart\'s table', { status: 422 }) : served(input),
    );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    values = () => ['admin'];
    const done = addFilter(quickInput, query, filterableTables([byHost]), anchorElement, new FieldsCache());
    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toContain('host String'));
    options().find((optionElement) => optionElement.textContent?.trim() === 'host String')!.click();
    await pick('host = …', 'host ≠ …');
    await pick('admin');
    await done;

    expect(query.get(FILTERS)).toEqual([]);
    expect(errors).toEqual(['Filter host = admin failed: 422: "host" cannot filter this chart\'s table']);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('opens the field step at once, busy until the charts’ /fields answer', async () => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const fetchFields = fetch;
    vi.stubGlobal('fetch', async (input: string) => (input.includes('/fields') ? answered.then(() => fetchFields(input)) : fetchFields(input)));
    void addFilter(quickInput, query, filterableTables([byHost]), anchorElement, new FieldsCache());

    const progress = () => hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick-progress');
    await vi.waitFor(() => expect(progress()?.hidden).toBe(false));
    expect(options()).toEqual([]);
    answer();
    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(['timestamp DateTime', 'status UInt16', 'user String', 'host String']));
    expect(progress()!.hidden).toBe(true);
  });

  it('groups the fields into the table’s columns, from the schema, and the computed fields, each once', async () => {
    void addFilter(quickInput, query, filterableTables([byHost, byPath]), anchorElement, new FieldsCache());

    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(['timestamp DateTime', 'status UInt16', 'user String', 'host String']));
    expect(headings()).toEqual(['Table columns', 'Computed fields']);
    // `path` is a column of byPath, but not of the table's schema here: only the schema's columns are listed
    // the computed field's chart is the table's first: its /fields once
    expect(fetched.map((url) => url.pathname)).toEqual(['/p/shop/api/1/fields']);
  });

  it('asks the /fields of each chart a computed field comes from, its type from there', async () => {
    const other = chart('/p/shop/api/4', 'default.http_logs', ['instance'], 'default', ['instance']);
    computed['/p/shop/api/4'] = [{ name: 'instance', type: 'LowCardinality(String)' }];
    columns['/p/shop/api/4'] = [];
    void addFilter(quickInput, query, filterableTables([byHost, other]), anchorElement, new FieldsCache());

    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(['timestamp DateTime', 'status UInt16', 'user String', 'host String', 'instance LowCardinality(String)']));
    expect(fetched.map((url) => url.pathname).sort()).toEqual(['/p/shop/api/1/fields', '/p/shop/api/4/fields']);
  });

  it('lists the charts’ plain fields as columns when the schema is not to be had, its message at the heading', async () => {
    columns = {};
    values = () => ['500'];
    const done = addFilter(quickInput, query, filterableTables([byHost]), anchorElement, new FieldsCache());

    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(['status', 'timestamp', 'host']));
    // its /fields failed too: no type, so = and ≠
    expect(headings()).toEqual([expect.stringContaining('502: query system.tables: unreachable'), 'Computed fields']);
    options()[0].click();
    await pick('status = …', 'status ≠ …');
    await pick('500');
    await done;

    // made by its chart as its field, not as a column
    expect(fetched.at(-1)!.searchParams.get('field')).toBe('status');
  });

  it('asks a column’s values and pill by `column`, its type from the schema', async () => {
    values = () => ['bob'];
    const done = addFilter(quickInput, query, filterableTables([byHost]), anchorElement, new FieldsCache());

    await vi.waitFor(() => expect(options()).toHaveLength(4));
    options()[2].click();
    await pick('user = …', 'user ≠ …');
    await pick('bob');
    await done;

    expect(query.get(FILTERS)).toEqual([{ kind: 'pill', key: 'key:column user:eq:bob' }]);
    expect(fetched.map((url) => url.pathname)).toEqual(['/p/shop/api/1/fields', '/p/shop/api/1/values', '/p/shop/api/1/pill']);
    expect(fetched[1].searchParams.get('column')).toBe('user');
    expect(fetched[2].searchParams.has('type')).toBe(false);
  });

  it('offers a time’s operators, ≥ and ≤ first, and asks its value in an input box at the time range’s edge', async () => {
    const done = addFilter(quickInput, query, filterableTables([byHost]), anchorElement, new FieldsCache());

    await vi.waitFor(() => expect(options()).toHaveLength(4));
    options()[0].click();
    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(['timestamp ≥ …', 'timestamp ≤ …', 'timestamp > …', 'timestamp < …', 'timestamp = …', 'timestamp ≠ …']));
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
    void addFilter(quickInput, query, filterableTables([audit]), anchorElement, new FieldsCache());

    await pick('action LowCardinality(String)');
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    expect(options().map((optionElement) => optionElement.querySelector('[role=img]')?.innerHTML)).toEqual([OP_ICONS.eq.svg, OP_ICONS.ne.svg]);
    expect(options().map((optionElement) => optionElement.querySelector('[role=img]')?.getAttribute('aria-label'))).toEqual([OP_ICONS.eq.label, OP_ICONS.ne.label]);
  });

  it('asks no table when the page has one, and adds nothing on Escape', async () => {
    const done = addFilter(quickInput, query, filterableTables([audit]), anchorElement, new FieldsCache());

    await pick('action LowCardinality(String)');
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await done;

    expect(query.get(FILTERS)).toEqual([]);
  });
});

describe('addFilter with SQL chips taken', () => {
  /** The SQL input box with the SQL editor of codemirror.ts, as the filters extension asks. */
  const askSql: AskSql = (options) => showSqlInputBox(quickInput, async () => (await import('../sql-library/codemirror')).sqlEditors, options);
  /** The SQL editor in the open box, once it is there. */
  const editor = () => EditorView.findFromDOM(hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick .cm-editor')!)!;

  it('ends the table’s pick with "SQL condition…", which asks the condition in the SQL editor’s input box and adds a SQL chip', async () => {
    const done = addFilter(quickInput, query, filterableTables([byHost, audit]), anchorElement, new FieldsCache(), askSql);

    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(['default.http_logs default', 'audit logs', expect.stringContaining('SQL condition…')]));
    expect(headings()).toEqual(['Advanced']);
    options()[2].click();
    await vi.waitFor(() => expect(options()).toHaveLength(0));
    await vi.waitFor(() => expect(hostContainer.querySelector('.d-workbench__quick-pick .cm-editor')).not.toBeNull());
    expect(editor().contentDOM.getAttribute('aria-label')).toBe('SQL condition');
    editor().dispatch({ changes: { from: 0, insert: 'duration > 2000' } });
    editor().contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await done;

    expect(query.get(FILTERS)).toEqual([{ kind: 'sql', sql: 'duration > 2000' }]);
  });

  it('ends the field’s pick with it on a page of one table, and is the only entry without one', async () => {
    void addFilter(quickInput, query, filterableTables([audit]), anchorElement, new FieldsCache(), askSql);
    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(['action LowCardinality(String)', expect.stringContaining('SQL condition…')]));
    void addFilter(quickInput, query, [], anchorElement, new FieldsCache(), askSql);
    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual([expect.stringContaining('SQL condition…')]));
  });

  it('adds nothing on Escape in the input box', async () => {
    const done = addFilter(quickInput, query, [], anchorElement, new FieldsCache(), askSql);
    await vi.waitFor(() => expect(options()).toHaveLength(1));
    options()[0].click();
    await vi.waitFor(() => expect(hostContainer.querySelector('.d-workbench__quick-pick .cm-editor')).not.toBeNull());
    editor().contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await done;

    expect(query.get(FILTERS)).toEqual([]);
  });
});

describe('askValue', () => {
  const known = (type: string) => ({ type, timeRange: { from, to } });
  const load = async () => [];

  it('fills in the time range’s start for ≥ and its end for ≤, a day as its date', async () => {
    void askValue(quickInput, anchorElement, 'timestamp ≥', 'ge', known('Nullable(DateTime64(3))'), load);
    await vi.waitFor(() => expect(field().value).toBe('2026-10-31T09:00:00.000Z'));
    void askValue(quickInput, anchorElement, 'day ≤', 'le', known('Date'), load);
    await vi.waitFor(() => expect(field().value).toBe('2026-10-31'));
  });

  it('offers the values `load` finds for anything else', async () => {
    const asked: string[] = [];
    void askValue(quickInput, anchorElement, 'host =', 'eq', known('String'), async (search) => (asked.push(search), ['x']));
    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(['x']));
    expect(asked).toEqual(['']);
  });
  it('opens the value’s quick pick at once for a type still to come, busy, and asks the values once it is there', async () => {
    let answer!: (type: { type: string }) => void;
    const asked: string[] = [];
    void askValue(quickInput, anchorElement, 'host =', 'eq', new Promise((resolve) => (answer = resolve)), async (search) => (asked.push(search), ['x']));

    const progress = () => hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick-progress')!;
    expect([progress().hidden, asked]).toEqual([false, []]);
    answer(known('String'));
    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(['x']));
    expect([progress().hidden, asked]).toEqual([true, ['']]);
  });

  it('puts a time’s input box in the place of the busy value pick once its type is there', async () => {
    const done = askValue(quickInput, anchorElement, 'timestamp ≥', 'ge', Promise.resolve(known('DateTime')), load, '2026-10-31T08:00:00Z');

    await vi.waitFor(() => expect(field().value).toBe('2026-10-31T08:00:00Z'));
    expect(hostContainer.querySelector('[role=listbox]')).toBeNull();
    enter();
    expect(await done).toBe('2026-10-31T08:00:00Z');
  });
});

describe('pickValue', () => {
  it('asks again as the text rests, offers the typed text first, and resolves with the value chosen', async () => {
    const searches: string[] = [];
    const done = pickValue(quickInput, anchorElement, 'host =', async (search) => (searches.push(search), ['shop-1', 'shop-2', ''].filter((v) => v.includes(search))));

    await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent?.trim())).toEqual(['shop-1', 'shop-2', '(empty)']));
    type('shop-');
    await vi.waitFor(() => expect(searches).toEqual(['', 'shop-']));
    await pick('shop- as typed', 'shop-1', 'shop-2');

    expect(await done).toBe('shop-');
  });

  it('shows the message of a failed answer', async () => {
    void pickValue(quickInput, anchorElement, 'host =', async () => {
      throw new Error('500: clickhouse query');
    });

    await vi.waitFor(() => expect(hostContainer.textContent).toContain('500: clickhouse query'));
  });
});

describe('fetchValues', () => {
  it('asks <dataUrl>/values with the query state, the field and the search', async () => {
    values = () => ['a'];

    expect(await fetchValues('/p/shop/api/1', { field: 'host' }, 'sh', new URLSearchParams({ time: '1h', f: 'k' }))).toEqual(['a']);
    expect(fetched[0].pathname + fetched[0].search).toBe('/p/shop/api/1/values?time=1h&f=k&field=host&search=sh');
  });

  it('asks a column by `column`', async () => {
    await fetchValues('/p/shop/api/1', { field: 'user', column: true }, '', new URLSearchParams({ time: '1h' }));
    expect(fetched[0].search).toBe('?time=1h&column=user&search=');
  });
});

describe('fetchFields', () => {
  it('asks <dataUrl>/fields with the query state: the columns and computed fields with their types, and the resolved time range', async () => {
    expect(await fetchFields('/p/shop/api/1', new URLSearchParams({ time: '1h' }))).toEqual({
      columns: columns['/p/shop/api/1'],
      computed: [{ name: 'host', type: 'String' }],
      timeRange: { from, to },
    });
    expect(fetched[0].pathname + fetched[0].search).toBe('/p/shop/api/1/fields?time=1h');
  });

  it('rejects with the server’s message', async () => {
    await expect(fetchFields('/p/shop/api/9', new URLSearchParams())).rejects.toThrow('502: query system.tables: unreachable');
  });
});

describe('typeIn', () => {
  const fields = { columns: [{ name: 'host', type: 'String' }, { name: 'status', type: 'UInt16' }], computed: [{ name: 'host', type: 'LowCardinality(String)' }], timeRange: { from, to } };

  it('is a column’s among the columns, a field’s among the computed fields, else the column of its name', () => {
    expect(typeIn(fields, { field: 'host', column: true })).toEqual({ type: 'String', timeRange: { from, to } });
    expect(typeIn(fields, { field: 'host' })).toEqual({ type: 'LowCardinality(String)', timeRange: { from, to } });
    expect(typeIn(fields, { field: 'status' })?.type).toBe('UInt16');
    expect(typeIn(fields, { field: 'path' })).toBeUndefined();
  });
});

describe('FieldsCache', () => {
  it('asks a chart once per query state, the filter chips left out', async () => {
    const cache = new FieldsCache();
    await cache.get('/p/shop/api/1', new URLSearchParams({ time: '1h', f: 'a' }));
    await cache.get('/p/shop/api/1', new URLSearchParams({ time: '1h', f: 'b', sql: 'x' }));
    await cache.get('/p/shop/api/3', new URLSearchParams({ time: '1h' }));
    await cache.get('/p/shop/api/1', new URLSearchParams({ time: '24h' }));

    expect(fetched.map((url) => url.pathname + url.search)).toEqual(['/p/shop/api/1/fields?time=1h', '/p/shop/api/3/fields?time=1h', '/p/shop/api/1/fields?time=24h']);
  });

  it('asks again after a failed answer', async () => {
    const cache = new FieldsCache();
    await expect(cache.get('/p/shop/api/9', new URLSearchParams())).rejects.toThrow('502');
    await expect(cache.get('/p/shop/api/9', new URLSearchParams())).rejects.toThrow('502');
    expect(fetched).toHaveLength(2);
  });
});
