// @vitest-environment jsdom
// Tests for schema.ts: the panel only with Explore, the page's connections first, a connection asked when opened,
// a table as DataGrip shows it, Refresh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, Schema, SchemaTable, WorkbenchJson } from '../../generated/zz_generated.dashica';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { drawTable, orderConnections, pageConnections, schema } from './schema';

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
const answer: Schema = { databases: [{ name: 'default', tables: [httpLogs] }] };

/** A dashboard whose charts run on `connections`, one table each, the last inside a grid. */
function dashboard(...connections: string[]): PageJson {
  type Node = PageJson['widgets'][number];
  const tables = connections.map((connection, i) => ({ type: 'table', props: { height: 500 }, dataUrl: `/p/shop/api/${i}`, connection }) as Node);
  const last = tables.pop();
  const grid = last && ({ type: 'grid', props: { template: 'a' }, children: { a: last } } as unknown as Node);
  return { kind: 'dashboard', title: 'Shop', filterBar: false, filterButtons: [], widgets: grid ? [...tables, grid] : tables };
}

describe('pageConnections and orderConnections', () => {
  it('are the connections of the page’s charts, nested ones too, each once; first those, in dashica_config’s order', () => {
    expect(pageConnections(dashboard('logs', 'default', 'logs'))).toEqual(['logs', 'default']);
    expect(pageConnections(undefined)).toEqual([]);
    expect(orderConnections(['alert_storage', 'default', 'logs'], ['logs', 'default'])).toEqual({ shown: ['default', 'logs'], others: ['alert_storage'] });
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
    expect(el.querySelector('.d-schema__index')!.textContent).toBe('INDEX path_idx path TYPE bloom_filter(0.01) GRANULARITY 4');
    expect(drawTable({ ...httpLogs, skipIndices: [] }).querySelector('.d-schema__indices')).toBeNull();
  });
});

describe('schema', () => {
  let body: HTMLElement;
  let registered: number;
  let pageChanged: EventEmitter<PageJson | undefined>;
  let current: PageJson | undefined;
  let commands: Map<string, () => unknown>;
  let menu: { menuId: string; command: string } | undefined;
  let fetched: string[];

  const activate = (workbench: Partial<WorkbenchJson>) =>
    schema.activate({
      subscriptions: [],
      ui: {
        registerSidePanel: () => (registered++, { body, dispose() {} }),
        registerMenuItem: (menuId: string, item: { command: string }) => ((menu = { menuId, command: item.command }), { dispose() {} }),
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
    current = dashboard('logs');
    commands = new Map();
    menu = undefined;
    fetched = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return new Response(JSON.stringify(answer), { status: 200 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  const names = () => [...body.querySelectorAll('[data-testid="schema-connection"] > summary')].map((s) => s.textContent);
  const groups = () => [...body.querySelectorAll('.d-schema__group')].map((g) => g.textContent);
  const open = async (connection: string) => {
    const node = [...body.querySelectorAll<HTMLDetailsElement>('[data-testid="schema-connection"]')].find((n) => n.querySelector('summary')!.textContent === connection)!;
    node.open = true; // the browser fires `toggle`
    await vi.waitFor(() => expect(node.querySelector('[data-testid="schema-table"]')).not.toBeNull());
    return node;
  };

  it('is not there while Explore is off', () => {
    activate({ explore: false });
    expect(registered).toBe(0);
    expect(body.childElementCount).toBe(0);
  });

  it('lists the page’s connections first, the others below, and follows the page shown', () => {
    activate({});
    expect(groups()).toEqual(['On this page', 'Other connections']);
    expect(names()).toEqual(['logs', 'alert_storage', 'default']);
    current = dashboard('default', 'logs');
    pageChanged.fire(current);
    expect(names()).toEqual(['default', 'logs', 'alert_storage']);
    current = undefined;
    pageChanged.fire(current);
    expect(groups()).toEqual(['Connections']);
    expect(fetched).toEqual([]);
  });

  it('asks a connection’s schema when it is opened the first time, and keeps it open when another page is shown', async () => {
    activate({});
    const logs = await open('logs');
    expect(fetched).toEqual(['/schema.json?connection=logs']);
    expect(logs.querySelector('.d-schema__children > details > summary')!.textContent).toBe('default1');
    logs.open = false;
    await new Promise((resolve) => logs.addEventListener('toggle', resolve, { once: true }));
    logs.open = true;
    await new Promise((resolve) => logs.addEventListener('toggle', resolve, { once: true }));
    expect(fetched).toHaveLength(1);
    pageChanged.fire(dashboard('default'));
    expect(body.contains(logs)).toBe(true);
    expect(logs.open).toBe(true);
  });

  it('shows a failed answer in place and asks again on the next opening', async () => {
    vi.stubGlobal('fetch', async (url: string) => (fetched.push(url), new Response('connection refused', { status: 502 })));
    activate({});
    const node = body.querySelector<HTMLDetailsElement>('[data-testid="schema-connection"]')!;
    node.open = true;
    await vi.waitFor(() => expect(node.querySelector('.d-notice--error')!.textContent).toBe('502 connection refused'));
    expect(fetched).toHaveLength(1);
    node.open = false;
    await new Promise((resolve) => node.addEventListener('toggle', resolve, { once: true }));
    node.open = true;
    await vi.waitFor(() => expect(fetched).toHaveLength(2));
  });

  it('has Refresh in its "…", which asks the server again for the connections opened only', async () => {
    activate({});
    expect(menu).toEqual({ menuId: 'panel/schema', command: 'schema.refresh' });
    await open('logs');
    await commands.get('schema.refresh')!();
    expect(fetched).toEqual(['/schema.json?connection=logs', '/schema.json?connection=logs&refresh=1']);
  });
});
