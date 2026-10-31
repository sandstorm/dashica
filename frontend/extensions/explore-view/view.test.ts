// @vitest-environment jsdom
// Tests for renderExploreView in view.ts, Perspective faked at its module boundary: the rows with the page's query
// state, their description, the config from the chart or kept per chart, Reset, a refresh, "Remove grouping", a click
// on a group row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../core/disposable/disposable';
import type { Memento } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import type { ViewerConfig } from './mapping';
import { persistable, renderExploreView, type ChartWithRows, stateKey, type Perspective, type PerspectiveTable, type PerspectiveViewer, type ViewSelection } from './view';

const widget = {
  type: 'timeBar',
  props: { title: 'Requests', x: { kind: 'autoBucket', alias: 'time' }, y: { kind: 'count', alias: 'requests' }, fill: { kind: 'expr', alias: 'status' } },
  dataUrl: '/p/shop/api/3',
  rowsUrl: '/p/shop/api/3/rows',
} as ChartWithRows;

/** What the fake Perspective was asked. */
let tables: { data: string; replaced: string[]; deleted: boolean }[];
let viewer: PerspectiveViewer & { restored: ViewerConfig[]; resets: number; saved: ViewerConfig };
let schema: Record<string, string>;
let failRestoreOf: ((config: ViewerConfig) => boolean) | undefined;
/** While set, a new table waits for it (Perspective still loading). */
let tableGate: Promise<void> | undefined;
let viewersMade: number;
const perspective: Perspective = {
  async worker() {
    return {
      async table(arrow: ArrayBuffer) {
        await tableGate;
        const record = { data: new TextDecoder().decode(arrow), replaced: [] as string[], deleted: false };
        tables.push(record);
        const table: PerspectiveTable = {
          async replace(next) {
            record.replaced.push(new TextDecoder().decode(next));
          },
          schema: async () => schema,
          size: async () => 3,
          async delete() {
            record.deleted = true;
          },
        };
        return table;
      },
    };
  },
  createViewer(doc) {
    viewersMade++;
    const el = doc.createElement('div') as unknown as typeof viewer;
    Object.assign(el, {
      restored: [],
      resets: 0,
      saved: {},
      load: async () => {},
      restore: async (config: ViewerConfig) => {
        if (failRestoreOf?.(config)) throw new Error('Invalid column "gone"');
        el.restored.push(config);
      },
      save: async () => el.saved,
      reset: async () => el.resets++,
      delete: async () => {},
    });
    viewer = el;
    return el;
  },
};

let stored: Map<string, unknown>;
const state: Memento = {
  get: <T>(key: string, defaultValue?: T) => (stored.has(key) ? (stored.get(key) as T) : defaultValue) as T,
  update: async (key, value) => void (value === undefined ? stored.delete(key) : stored.set(key, value)),
};

let query: QueryHost;
let el: HTMLElement;
let view: Disposable;
let requests: string[];
let closed: number;
let selected: ViewSelection[];
let answer: (url: URL) => Response;

const rowsResponse = (body = 'rows-1', headers: Record<string, string> = {}) => new Response(body, { headers: { 'X-Dashica-Grouping': 'removable', ...headers } });
/** The server's answer: the chart's result, or without grouping its rows, at most 3. */
const serve = (result: string, ungrouped = 'raw-1') => (url: URL) =>
  url.searchParams.get('grouping') === 'none' ? rowsResponse(ungrouped, { 'X-Dashica-Rows-Limit': '3' }) : rowsResponse(result);

beforeEach(() => {
  query = new QueryHost(window);
  query.load({ search: '?time=1h&f=host:eq:a', defaultTime: '24h' });
  tables = [];
  schema = { time: 'datetime', status: 'integer', host: 'string', requests: 'integer' };
  failRestoreOf = undefined;
  tableGate = undefined;
  viewersMade = 0;
  stored = new Map();
  requests = [];
  closed = 0;
  selected = [];
  answer = serve('rows-1');
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(url);
    return answer(new URL(url, location.origin));
  });
  el = document.body.appendChild(document.createElement('div'));
});

afterEach(() => {
  view?.dispose();
  query.dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function open(): void {
  view = renderExploreView(el, { widget, query, state, perspective: async () => perspective, close: () => closed++, select: (selection) => selected.push(selection) });
}

/** Lets the fetches and Perspective's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('renderExploreView', () => {
  it('fetches the chart’s result with the page’s query state', async () => {
    open();
    await settle();
    expect(requests).toEqual(['/p/shop/api/3/rows?time=1h&f=host%3Aeq%3Aa']);
    expect(tables.map((t) => t.data)).toEqual(['rows-1']);
    expect(el.querySelector('.d-explore-view__title')!.textContent).toBe('Explore: Requests');
    expect(el.querySelector('.d-explore-view__status')!.textContent).toBe('3 rows of the chart’s result');
  });

  it('starts with the chart rebuilt from its props', async () => {
    open();
    await settle();
    expect(viewer.restored).toEqual([expect.objectContaining({ plugin: 'Y Bar', group_by: ['time'], split_by: ['status'], columns: ['requests'] })]);
    expect(el.querySelector('.d-explore-view__notes')!.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the config the viewer changed per chart, and starts with it next time', async () => {
    open();
    await settle();
    viewer.dispatchEvent(new Event('perspective-config-update'));
    expect(stored.size).toBe(0);
    viewer.dispatchEvent(new Event('pointerdown'));
    const changed = { plugin: 'Datagrid', group_by: ['host'], table: 'a1b2', theme: 'Pro Light' };
    viewer.dispatchEvent(new CustomEvent('perspective-config-update', { detail: { getConfig: () => changed } }));
    expect(stored.get(stateKey(widget))).toEqual({ plugin: 'Datagrid', group_by: ['host'] });
    view.dispose();
    open();
    await settle();
    expect(viewer.restored).toEqual([{ plugin: 'Datagrid', group_by: ['host'] }]);
  });

  it('shows the chart when the kept config does not fit the rows, with a note', async () => {
    stored.set(stateKey(widget), { plugin: 'Datagrid', group_by: ['gone'] });
    failRestoreOf = (config) => config.group_by?.[0] === 'gone';
    open();
    await settle();
    expect(viewer.restored).toEqual([expect.objectContaining({ plugin: 'Y Bar' })]);
    expect(el.querySelector('.d-explore-view__notes')!.textContent).toContain('the kept view does not fit these rows (Invalid column "gone")');
  });

  it('goes back to the chart’s config on Reset, forgetting the kept one', async () => {
    stored.set(stateKey(widget), { plugin: 'Datagrid' });
    open();
    await settle();
    el.querySelector<HTMLButtonElement>('[data-testid="explore-view-reset"]')!.click();
    await settle();
    expect(stored.size).toBe(0);
    expect(viewer.resets).toBe(1);
    expect(viewer.restored.at(-1)).toMatchObject({ plugin: 'Y Bar' });
  });

  it('fetches the rows again on a refresh and puts them into the same table, the config kept', async () => {
    open();
    await settle();
    answer = serve('rows-2');
    query.time.setRange('3h');
    await settle();
    expect(requests.at(-1)).toBe('/p/shop/api/3/rows?time=3h&f=host%3Aeq%3Aa');
    expect(tables).toHaveLength(1);
    expect(tables[0].replaced).toEqual(['rows-2']);
    expect(viewer.restored).toHaveLength(1);
  });

  it('shows one viewer when a refresh comes while Perspective still loads, the older rows’ table deleted', async () => {
    let release: () => void = () => {};
    tableGate = new Promise((resolve) => (release = resolve));
    open();
    await settle();
    answer = serve('rows-2');
    query.refresh();
    await settle();
    release();
    await settle();
    expect(tables.map(({ data, deleted }) => ({ data, deleted }))).toEqual([
      { data: 'rows-1', deleted: true },
      { data: 'rows-2', deleted: false },
    ]);
    expect(viewersMade).toBe(1);
    expect(el.querySelectorAll('.d-explore-view__viewer')).toHaveLength(1);
  });

  it('makes no viewer when disposed while Perspective still loads, the table deleted', async () => {
    let release: () => void = () => {};
    tableGate = new Promise((resolve) => (release = resolve));
    open();
    await settle();
    view.dispose();
    release();
    await settle();
    expect(tables[0].deleted).toBe(true);
    expect(viewersMade).toBe(0);
  });

  it('notes what the mapping left out', async () => {
    schema = { time: 'datetime', requests: 'integer' };
    open();
    await settle();
    expect([...el.querySelectorAll('.d-explore-view__notes li')].map((li) => li.textContent)).toEqual(['`fill` (`status`) is not a column of the chart’s result']);
  });

  it('shows the rows without grouping on "Remove grouping", in a new viewer, and the chart’s result again', async () => {
    open();
    await settle();
    const ungroup = el.querySelector<HTMLButtonElement>('[data-testid="explore-view-ungroup"]')!;
    expect(ungroup.hidden).toBe(false);
    schema = { timestamp: 'datetime', status: 'integer', host: 'string' };
    ungroup.click();
    await settle();
    expect(requests.at(-1)).toBe('/p/shop/api/3/rows?time=1h&f=host%3Aeq%3Aa&grouping=none');
    expect(ungroup.getAttribute('aria-pressed')).toBe('true');
    expect(tables.map(({ data, deleted }) => ({ data, deleted }))).toEqual([
      { data: 'rows-1', deleted: true },
      { data: 'raw-1', deleted: false },
    ]);
    expect(viewersMade).toBe(2);
    expect(el.querySelectorAll('.d-explore-view__viewer')).toHaveLength(1);
    expect(viewer.restored).toEqual([expect.objectContaining({ plugin: 'Datagrid', group_by: [], columns: ['timestamp', 'status', 'host'] })]);
    expect(el.querySelector('.d-explore-view__status')!.textContent).toBe('the newest 3 rows (limit)');
    ungroup.click();
    await settle();
    expect(requests.at(-1)).toBe('/p/shop/api/3/rows?time=1h&f=host%3Aeq%3Aa');
    expect(ungroup.getAttribute('aria-pressed')).toBe('false');
    expect(tables.at(-1)!.data).toBe('rows-1');
  });

  it('keeps the viewer’s config of the rows without grouping apart from the result’s', async () => {
    stored.set(stateKey(widget), { plugin: 'Y Line' });
    stored.set(stateKey(widget, true), { plugin: 'Datagrid', group_by: ['host'] });
    open();
    await settle();
    expect(viewer.restored).toEqual([{ plugin: 'Y Line' }]);
    el.querySelector<HTMLButtonElement>('[data-testid="explore-view-ungroup"]')!.click();
    await settle();
    expect(viewer.restored).toEqual([{ plugin: 'Datagrid', group_by: ['host'] }]);
  });

  it('offers no "Remove grouping" when the server does not serve the rows without grouping', async () => {
    answer = () => new Response('rows-1');
    open();
    await settle();
    expect(el.querySelector<HTMLButtonElement>('[data-testid="explore-view-ungroup"]')!.hidden).toBe(true);
  });

  it('shows the chart’s Diagnostics: the filters it ignores, a skipped chart', async () => {
    answer = () => new Response(null, { status: 204, headers: { 'X-Dashica-Diagnostics': '{"skipped":"pick a host first"}' } });
    open();
    await settle();
    expect(el.querySelector('.d-explore-view__body')!.textContent).toBe('skipped: pick a host first');
    answer = () => rowsResponse('rows', { 'X-Dashica-Diagnostics': '{"ignored":["host"]}' });
    query.refresh();
    await settle();
    expect(el.querySelector('.d-badge')!.textContent).toBe('ignores host');
    expect(tables).toHaveLength(1);
  });

  it('shows the server’s error in place of the viewer', async () => {
    answer = () => new Response('Code: 47. Unknown identifier host', { status: 500 });
    open();
    await settle();
    expect(el.querySelector('.d-notice--error')!.textContent).toBe('500 Code: 47. Unknown identifier host');
  });

  it('selects the deepest group value of a clicked row on a column of the rows, no time', async () => {
    open();
    await settle();
    const click = (filter: unknown[]) => viewer.dispatchEvent(new CustomEvent('perspective-click', { detail: { config: { filter } } }));
    click([['time', '==', 1], ['status', '==', 500], ['host', '==', 'a']]);
    click([['time', '==', 1]]);
    click([]);
    expect(selected.map(({ fieldId, value }) => ({ fieldId, value }))).toEqual([{ fieldId: 'host', value: 'a' }]);
    expect(selected[0].anchor.isConnected).toBe(true);
  });

  it('selects nothing from the rows without grouping, whose raw values the chart’s dimensions would not match', async () => {
    open();
    await settle();
    schema = { timestamp: 'datetime', customer_project: 'string' };
    el.querySelector<HTMLButtonElement>('[data-testid="explore-view-ungroup"]')!.click();
    await settle();
    viewer.dispatchEvent(new CustomEvent('perspective-click', { detail: { config: { filter: [['customer_project', '==', 'sandstorm.shop']] } } }));
    expect(selected).toEqual([]);
  });

  it('closes on Close', async () => {
    open();
    el.querySelector<HTMLButtonElement>('[data-testid="explore-view-close"]')!.click();
    expect(closed).toBe(1);
  });

  it('deletes the table when disposed', async () => {
    open();
    await settle();
    view.dispose();
    await settle();
    expect(tables[0].deleted).toBe(true);
    expect(el.children).toHaveLength(0);
  });
});

describe('persistable', () => {
  it('leaves out the table’s name, the theme and the title', () => {
    expect(persistable({ plugin: 'Y Bar', table: 't1', theme: 'Pro Dark', title: 'x', settings: true })).toEqual({ plugin: 'Y Bar', settings: true });
  });
});
