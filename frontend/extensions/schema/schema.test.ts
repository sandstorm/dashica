// @vitest-environment jsdom
// Tests for schema.ts: the panel only with Explore, "On this page" the page's tables, "All connections" a connection
// asked when opened, the views' closed state kept, a table as DataGrip shows it, Refresh, Show comments.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, Schema, SchemaTable, WorkbenchJson } from '../../generated/zz_generated.dashica';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { drawTable, onlyTables, pageTables, schema } from './schema';

const httpLogs: SchemaTable = {
  name: 'http_logs',
  engine: 'MergeTree',
  sortingKey: 'host, timestamp',
  partitionKey: 'toDate(timestamp)',
  primaryKey: 'host, timestamp',
  ttl: 'timestamp + toIntervalDay(30)',
  comment: '',
  columns: [
    { name: 'timestamp', type: 'DateTime64(6)', defaultKind: '', defaultExpression: '', comment: 'when it was asked' },
    { name: 'day', type: 'Date', defaultKind: 'MATERIALIZED', defaultExpression: 'toDate(timestamp)', comment: '' },
  ],
  skipIndices: [{ name: 'path_idx', type: 'bloom_filter(0.01)', expression: 'path', granularity: 4 }],
};
const answer: Schema = {
  database: 'default',
  databases: [
    { name: 'default', tables: [httpLogs, { ...httpLogs, name: 'orders' }] },
    { name: 'logs', tables: [{ ...httpLogs, name: 'http_logs' }] },
  ],
};

/** A dashboard whose charts read `tables` (`<connection>:<table>`, or a table on `default`), the last inside a grid. */
function dashboard(...tables: string[]): PageJson {
  type Node = PageJson['widgets'][number];
  const charts = tables.map((spec, i) => {
    const [connection, table] = spec.includes(':') ? spec.split(':') : ['default', spec];
    return { type: 'table', props: { height: 500 }, dataUrl: `/p/shop/api/${i}`, connection, table } as Node;
  });
  const last = charts.pop();
  const grid = last && ({ type: 'grid', props: { template: 'a' }, children: { a: last } } as unknown as Node);
  return { kind: 'dashboard', title: 'Shop', filterBar: false, filterButtons: [], widgets: grid ? [...charts, grid] : charts };
}

describe('pageTables and onlyTables', () => {
  it('are the tables the page’s charts read, nested ones too, each once, in page order', () => {
    expect(pageTables(dashboard('logs:http_logs', 'http_logs', 'logs:http_logs'))).toEqual([
      { connection: 'logs', table: 'http_logs' },
      { connection: 'default', table: 'http_logs' },
    ]);
    const noTable = { kind: 'dashboard', title: 'Shop', filterBar: false, filterButtons: [], widgets: [{ type: 'markdown', props: {} }] } as unknown as PageJson;
    expect(pageTables(noTable)).toEqual([]);
    expect(pageTables(undefined)).toEqual([]);
  });

  it('keep of the schema the tables named, a name without database in the connection’s own, in the schema’s order', () => {
    const { schema: only, missing } = onlyTables(answer, ['orders', 'logs.http_logs', 'http_logs', 'gone']);
    expect(only.databases.map((d) => [d.name, d.tables.map((t) => t.name)])).toEqual([
      ['default', ['http_logs', 'orders']],
      ['logs', ['http_logs']],
    ]);
    expect(missing).toEqual(['gone']);
    expect(onlyTables({ ...answer, database: 'logs' }, ['http_logs']).schema.databases.map((d) => d.name)).toEqual(['logs']);
  });
});

describe('drawTable', () => {
  it('shows the columns with type, default and comment, the keys it has, and the skip indices', () => {
    const el = drawTable(httpLogs);
    expect(el.querySelector('summary')!.textContent).toBe('http_logsMergeTree');
    expect([...el.querySelectorAll('.d-schema__column')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'timestamp DateTime64(6) when it was asked',
      'day Date MATERIALIZED toDate(timestamp)',
    ]);
    expect([...el.querySelectorAll('.d-schema__key')].map((k) => k.textContent)).toEqual(['Engine', 'ORDER BY', 'PARTITION BY', 'Primary key', 'TTL']);
    // each key and value its own cell of the two-column grid, not wrapped together in one
    expect([...el.querySelector('.d-schema__keys')!.children].map((c) => c.tagName)).toEqual(['DT', 'DD', 'DT', 'DD', 'DT', 'DD', 'DT', 'DD', 'DT', 'DD']);
    expect(el.querySelector('.d-schema__index')!.textContent).toBe('INDEX path_idx path TYPE bloom_filter(0.01) GRANULARITY 4');
    expect(drawTable({ ...httpLogs, skipIndices: [] }).querySelector('.d-schema__indices')).toBeNull();
  });
});

describe('schema', () => {
  let body: HTMLElement;
  let registered: number;
  let pageChanged: EventEmitter<PageJson | undefined>;
  let visibility: EventEmitter<void>;
  let visible: boolean;
  let current: PageJson | undefined;
  let commands: Map<string, () => unknown>;
  let menu: { menuId: string; command: string; title?: string; toggled?: () => boolean }[];
  let stored: Map<string, unknown>;
  let fetched: string[];

  const activate = (workbench: Partial<WorkbenchJson>) =>
    schema.activate({
      subscriptions: [],
      globalState: {
        get: (key: string, defaultValue?: unknown) => (stored.has(key) ? stored.get(key) : defaultValue),
        update: async (key: string, value: unknown) => void stored.set(key, value),
      },
      ui: {
        registerSidePanel: () => (
          registered++,
          {
            bodyContainer: body,
            get visible() {
              return visible;
            },
            onDidChangeVisibility: visibility.event,
            dispose() {},
          }
        ),
        registerMenuItem: (menuId: string, item: { command: string; title?: string; toggled?: () => boolean }) => (menu.push({ menuId, ...item }), { dispose() {} }),
      },
      commands: { registerCommand: (id: string, run: () => unknown) => (commands.set(id, run), { dispose() {} }) },
      page: {
        workbench: { menu: [], explore: true, connections: ['alert_storage', 'default', 'logs'], ...workbench },
        get current() {
          return current;
        },
        onDidChangePage: pageChanged.event,
      },
    } as unknown as ExtensionContext);

  beforeEach(() => {
    body = document.body.appendChild(document.createElement('div'));
    registered = 0;
    pageChanged = new EventEmitter();
    visibility = new EventEmitter();
    visible = false;
    current = dashboard('logs:http_logs');
    commands = new Map();
    menu = [];
    stored = new Map();
    fetched = [];
    // each connection's own database is the one named as it, else `default`
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      const connection = new URL(url, 'http://dashica').searchParams.get('connection');
      return new Response(JSON.stringify({ ...answer, database: connection === 'logs' ? 'logs' : 'default' }), { status: 200 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  const view = (id: string) => body.querySelector<HTMLElement>(`[data-view="${id}"]`)!;
  const connections = (id: string) => [...view(id).querySelectorAll('[data-testid="schema-connection"] > summary')].map((s) => s.textContent);
  /** The tables "On this page" shows, as `<connection> › <database> › <table>`. */
  const pageShown = () =>
    [...view('page').querySelectorAll('[data-testid="schema-table"]')].map((table) =>
      [table.closest('[data-testid="schema-connection"]')!, table.parentElement!.closest('details')!, table].map((d) => d.querySelector('.d-schema__name')!.textContent).join(' › '),
    );
  const show = () => {
    visible = true;
    visibility.fire();
  };
  const open = async (connection: string) => {
    const node = [...view('all').querySelectorAll<HTMLDetailsElement>('[data-testid="schema-connection"]')].find((n) => n.querySelector('summary')!.textContent === connection)!;
    node.open = true; // the browser fires `toggle`
    await vi.waitFor(() => expect(node.querySelector('[data-testid="schema-table"]')).not.toBeNull());
    return node;
  };

  it('is not there while Explore is off', () => {
    activate({ explore: false });
    expect(registered).toBe(0);
    expect(body.childElementCount).toBe(0);
  });

  it('shows in "On this page" the tables the page’s charts read, once the panel shows, and follows the page shown', async () => {
    activate({});
    expect([...body.querySelectorAll('.d-view__title')].map((t) => t.textContent)).toEqual(['On this page', 'All connections']);
    expect(fetched).toEqual([]);
    show();
    await vi.waitFor(() => expect(pageShown()).toEqual(['logs › logs › http_logs']));
    expect(fetched).toEqual(['/schema.json?connection=logs']);
    expect(view('page').querySelector<HTMLDetailsElement>('.d-schema__children > details')!.open).toBe(true);
    expect(view('page').querySelector<HTMLDetailsElement>('[data-testid="schema-table"]')!.open).toBe(false);

    current = dashboard('orders', 'logs:http_logs', 'http_logs', 'missing');
    pageChanged.fire(current);
    await vi.waitFor(() => expect(pageShown()).toEqual(['default › default › http_logs', 'default › default › orders', 'logs › logs › http_logs']));
    expect(view('page').querySelector('.d-schema__hint')!.textContent).toBe('missing: not in the schema.');
    expect(fetched).toEqual(['/schema.json?connection=logs', '/schema.json?connection=default']);

    current = undefined;
    pageChanged.fire(current);
    expect(view('page').querySelector('.d-view__body')!.textContent!.trim()).toBe('No chart of this page reads a table.');
  });

  it('draws "On this page" for a page changed while hidden only when shown again', async () => {
    activate({});
    current = dashboard('orders');
    pageChanged.fire(current);
    expect(fetched).toEqual([]);
    show();
    await vi.waitFor(() => expect(pageShown()).toEqual(['default › default › orders']));
  });

  it('lists every connection under "All connections", asked when opened the first time, kept open when another page is shown', async () => {
    activate({});
    expect(connections('all')).toEqual(['alert_storage', 'default', 'logs']);
    const logs = await open('logs');
    expect(fetched).toEqual(['/schema.json?connection=logs']);
    expect(logs.querySelector('.d-schema__children > details > summary')!.textContent).toBe('default2');
    logs.open = false;
    await new Promise((resolve) => logs.addEventListener('toggle', resolve, { once: true }));
    logs.open = true;
    await new Promise((resolve) => logs.addEventListener('toggle', resolve, { once: true }));
    show(); // "On this page" takes the schema asked already
    await vi.waitFor(() => expect(pageShown()).toHaveLength(1));
    expect(fetched).toHaveLength(1);
    pageChanged.fire(dashboard('orders'));
    expect(body.contains(logs)).toBe(true);
    expect(logs.open).toBe(true);
  });

  it('keeps whether the viewer closed a view', () => {
    activate({});
    view('all').querySelector<HTMLButtonElement>('.d-view__toggle')!.click();
    expect(stored.get('views.all.collapsed')).toBe(true);
    body.replaceChildren();
    activate({});
    expect(view('all').querySelector<HTMLElement>('.d-view__body')!.hidden).toBe(true);
    expect(view('page').querySelector<HTMLElement>('.d-view__body')!.hidden).toBe(false);
  });

  it('shows a failed answer in place and asks again on the next opening', async () => {
    vi.stubGlobal('fetch', async (url: string) => (fetched.push(url), new Response('connection refused', { status: 502 })));
    activate({});
    const node = view('all').querySelector<HTMLDetailsElement>('[data-testid="schema-connection"]')!;
    node.open = true;
    await vi.waitFor(() => expect(node.querySelector('.d-notice--error')!.textContent).toBe('502 connection refused'));
    expect(fetched).toHaveLength(1);
    node.open = false;
    await new Promise((resolve) => node.addEventListener('toggle', resolve, { once: true }));
    node.open = true;
    await vi.waitFor(() => expect(fetched).toHaveLength(2));
    show();
    await vi.waitFor(() => expect(view('page').querySelector('.d-notice--error')!.textContent).toBe('502 connection refused'));
  });

  it('has Refresh in its "…", which asks the server again for the connections asked only, and draws them again', async () => {
    activate({});
    expect(menu[0]).toMatchObject({ menuId: 'panel/schema', command: 'schema.refresh' });
    await open('logs');
    show();
    await vi.waitFor(() => expect(pageShown()).toHaveLength(1));
    const before = view('page').querySelector('[data-testid="schema-table"]');
    await commands.get('schema.refresh')!();
    expect(fetched).toEqual(['/schema.json?connection=logs', '/schema.json?connection=logs&refresh=1']);
    await vi.waitFor(() => expect(pageShown()).toHaveLength(1));
    expect(view('page').querySelector('[data-testid="schema-table"]')).not.toBe(before);
  });

  it('has "Show comments" in its "…", on by default, which hides the comments while off and keeps that', async () => {
    activate({});
    const entry = menu.find((item) => item.command === 'schema.toggleComments')!;
    expect(entry).toMatchObject({ menuId: 'panel/schema', title: 'Show comments' });
    const root = body.querySelector('.d-schema')!;
    expect(entry.toggled!()).toBe(true);
    expect(root.classList.contains('d-schema--no-comments')).toBe(false);
    await commands.get('schema.toggleComments')!();
    expect(entry.toggled!()).toBe(false);
    expect(root.classList.contains('d-schema--no-comments')).toBe(true);
    expect(stored.get('showComments')).toBe(false);
    body.replaceChildren();
    menu = [];
    activate({});
    expect(body.querySelector('.d-schema')!.classList.contains('d-schema--no-comments')).toBe(true);
  });
});
