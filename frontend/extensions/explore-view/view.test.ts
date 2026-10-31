// @vitest-environment jsdom
// Tests for renderExploreView in view.ts, Perspective faked at its module boundary: the rows with the page's query
// state, their description, the config from the chart or kept per chart, Reset, a refresh, the SQL editor (following
// the chart, Run and "Reset to the chart's query" as hash navigations, a draft, an error), a click on a group row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { Memento } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import type { ViewerConfig } from './mapping';
import {
  editedSql,
  persistable,
  renderExploreView,
  type ChartWithRows,
  stateKey,
  withEditedSql,
  type Perspective,
  type PerspectiveTable,
  type PerspectiveViewer,
} from './view';

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
/** What the view offered to filter by, and where. */
let offered: { at: unknown; candidates: readonly unknown[] }[];
let answer: (url: URL) => Response;
/** The tab's hash, as Run and Reset navigate it. */
let hash: string;
let hashChanged: EventEmitter<void>;
let navigations: string[];

const rowsResponse = (body = 'rows-1', headers: Record<string, string> = {}) => new Response(body, { headers: { 'X-Dashica-Sql': 'editable', ...headers } });
/**
 * The server's answer: at /sql the chart's SQL, its time range written in (`… time=1h`); at /rows the chart's result,
 * or an edited query's rows (`edited:<text>`), at most 3.
 */
const serve = (result: string) => (url: URL) => {
  if (url.pathname.endsWith('/sql')) return new Response(`SELECT time=${url.searchParams.get('time')}`);
  const edited = url.searchParams.get('xsql');
  return edited === null ? rowsResponse(result) : rowsResponse(`edited:${edited}`, { 'X-Dashica-Rows-Limit': '3' });
};

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
  offered = [];
  answer = serve('rows-1');
  hash = '#explore=3';
  hashChanged = new EventEmitter<void>();
  navigations = [];
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
  view = renderExploreView(el, {
    widget,
    query,
    state,
    perspective: async () => perspective,
    hash: () => hash,
    onDidChangeHash: hashChanged.event,
    navigate: (to) => {
      navigations.push(to);
      hash = to;
      hashChanged.fire();
    },
    close: () => closed++,
    offerFilters: (at, candidates) => offered.push({ at, candidates }),
  });
}

const find = <T extends HTMLElement>(testId: string) => el.querySelector<T>(`[data-testid="${testId}"]`)!;
const sqlText = () => find<HTMLTextAreaElement>('explore-view-sql-text');
/** Types `text` into the SQL editor. */
const type = (text: string) => {
  sqlText().value = text;
  sqlText().dispatchEvent(new Event('input'));
};

/** Lets the fetches and Perspective's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('renderExploreView', () => {
  it('fetches the chart’s result with the page’s query state', async () => {
    open();
    await settle();
    expect(requests[0]).toBe('/p/shop/api/3/rows?time=1h&f=host%3Aeq%3Aa');
    expect(tables.map((t) => t.data)).toEqual(['rows-1']);
    expect(el.querySelector('.d-explore-view__title')!.textContent).toBe('Explore: Requests');
    expect(el.querySelector('.d-explore-view__status')!.textContent).toBe('3 rows of the chart’s result');
  });

  it('takes Perspective’s theme of the page’s colour scheme, and follows a change of it', async () => {
    const changes = new EventTarget();
    let dark = true;
    vi.stubGlobal('matchMedia', (query: string) =>
      Object.assign(changes, { media: query, get matches() { return dark; } }),
    );
    open();
    await settle();
    expect(viewer.restored).toEqual([expect.objectContaining({ plugin: 'Y Bar', theme: 'Pro Dark' })]);
    dark = false;
    changes.dispatchEvent(new Event('change'));
    expect(viewer.restored.at(-1)).toEqual({ theme: 'Pro Light' });
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
    expect(viewer.restored).toEqual([{ plugin: 'Datagrid', group_by: ['host'], theme: 'Pro Light' }]);
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

  it('shows the SQL editor from the start, with the chart’s SQL as the server writes it for the page’s state, and again on a refresh', async () => {
    open();
    await settle();
    await settle();
    const button = find<HTMLButtonElement>('explore-view-sql');
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(find('explore-view-sql-panel').hidden).toBe(false);
    expect(find('explore-view-sql-off').hidden).toBe(true);
    expect(requests).toEqual(['/p/shop/api/3/rows?time=1h&f=host%3Aeq%3Aa', '/p/shop/api/3/sql?time=1h&f=host%3Aeq%3Aa']);
    expect(sqlText().value).toBe('SELECT time=1h');
    query.time.setRange('3h');
    await settle();
    expect(sqlText().value).toBe('SELECT time=3h');
    expect(find('explore-view-edited').hidden).toBe(true);
  });

  it('closes the editor with "SQL", asking for no SQL while closed, and opens it again', async () => {
    open();
    await settle();
    await settle();
    const button = find<HTMLButtonElement>('explore-view-sql');
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(find('explore-view-sql-panel').hidden).toBe(true);
    const asked = requests.length;
    query.time.setRange('3h');
    await settle();
    expect(requests.slice(asked)).toEqual(['/p/shop/api/3/rows?time=3h&f=host%3Aeq%3Aa']);
    button.click();
    await settle();
    expect(find('explore-view-sql-panel').hidden).toBe(false);
    expect(sqlText().value).toBe('SELECT time=3h');
  });

  it('offers no SQL editor when the server does not allow it, saying it is off (explore.enabled)', async () => {
    answer = () => new Response('rows-1');
    open();
    await settle();
    expect(find<HTMLButtonElement>('explore-view-sql').hidden).toBe(true);
    expect(find('explore-view-sql-panel').hidden).toBe(true);
    expect(find('explore-view-sql-off').hidden).toBe(false);
    expect(requests.some((url) => url.includes('/sql'))).toBe(false);
  });

  it('runs the edited SQL through the tab’s hash: its rows in a new viewer, the note, the limit; Reset goes back', async () => {
    open();
    await settle();
    await settle();
    schema = { timestamp: 'datetime', status: 'integer', host: 'string' };
    type('SELECT * FROM http_logs');
    find<HTMLButtonElement>('explore-view-run').click();
    await settle();
    expect(navigations).toEqual(['#explore=3&xsql=SELECT+*+FROM+http_logs']);
    expect(requests.at(-1)).toBe('/p/shop/api/3/rows?xsql=SELECT+*+FROM+http_logs');
    expect(tables.map(({ data, deleted }) => ({ data, deleted }))).toEqual([
      { data: 'rows-1', deleted: true },
      { data: 'edited:SELECT * FROM http_logs', deleted: false },
    ]);
    expect(viewersMade).toBe(2);
    expect(viewer.restored).toEqual([expect.objectContaining({ plugin: 'Datagrid', group_by: [], columns: ['timestamp', 'status', 'host'] })]);
    expect(el.querySelector('.d-explore-view__status')!.textContent).toBe('the first 3 rows (limit)');
    expect(find('explore-view-edited').hidden).toBe(false);
    expect(find('explore-view-edited').textContent).toContain('the page’s time range and filters do not apply');

    find<HTMLButtonElement>('explore-view-sql-reset').click();
    await settle();
    expect(navigations.at(-1)).toBe('#explore=3');
    expect(requests.slice(-2).sort()).toEqual(['/p/shop/api/3/rows?time=1h&f=host%3Aeq%3Aa', '/p/shop/api/3/sql?time=1h&f=host%3Aeq%3Aa']);
    expect(tables.at(-1)!.data).toBe('rows-1');
    expect(sqlText().value).toBe('SELECT time=1h');
    expect(find('explore-view-edited').hidden).toBe(true);
  });

  it('opens with the edited SQL of the tab’s hash (a reload, a link): its rows, the editor open; the page’s state does not change them', async () => {
    hash = withEditedSql('#explore=3', 'SELECT 1');
    open();
    await settle();
    expect(requests).toEqual(['/p/shop/api/3/rows?xsql=SELECT+1']);
    expect(find('explore-view-sql-panel').hidden).toBe(false);
    expect(sqlText().value).toBe('SELECT 1');
    query.time.setRange('3h');
    await settle();
    expect(requests.at(-1)).toBe('/p/shop/api/3/rows?xsql=SELECT+1');
  });

  it('follows the chart again when Run gets the chart’s SQL unchanged', async () => {
    open();
    await settle();
    await settle();
    find<HTMLButtonElement>('explore-view-run').click();
    expect(navigations).toEqual(['#explore=3']);
  });

  it('runs with Cmd/Ctrl+Enter in the editor', async () => {
    open();
    await settle();
    await settle();
    type('SELECT 2');
    sqlText().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    expect(editedSql(hash)).toBe('SELECT 2');
  });

  it('keeps a draft over a refresh, saying it was not run', async () => {
    open();
    await settle();
    await settle();
    expect(find('explore-view-sql-note').textContent).toBe('');
    type('SELECT draft');
    expect(find('explore-view-sql-note').textContent).toBe('not run');
    query.time.setRange('3h');
    await settle();
    expect(sqlText().value).toBe('SELECT draft');
    expect(find('explore-view-sql-note').textContent).toBe('not run');
  });

  it('shows the error of an edited query in place of the viewer, the editor keeping its text', async () => {
    answer = (url) =>
      url.searchParams.has('xsql') ? new Response('Code: 62. DB::Exception: Syntax error', { status: 500 }) : serve('rows-1')(url);
    open();
    await settle();
    await settle();
    type('SELEC 1');
    find<HTMLButtonElement>('explore-view-run').click();
    await settle();
    expect(el.querySelector('.d-explore-view__body .d-notice--error')!.textContent).toBe('500 Code: 62. DB::Exception: Syntax error');
    expect(sqlText().value).toBe('SELEC 1');
    expect(find('explore-view-sql-panel').hidden).toBe(false);
  });

  it('shows an error of the chart’s SQL below the editor', async () => {
    answer = (url) => (url.pathname.endsWith('/sql') ? new Response('Explore is not enabled', { status: 404 }) : serve('rows-1')(url));
    open();
    await settle();
    await settle();
    expect(find('explore-view-sql-panel').querySelector('.d-notice--error')!.textContent).toBe('404 Explore is not enabled');
  });

  it('keeps the viewer’s config of an edited query’s rows apart from the result’s', async () => {
    stored.set(stateKey(widget), { plugin: 'Y Line' });
    stored.set(stateKey(widget, true), { plugin: 'Datagrid', group_by: ['host'] });
    open();
    await settle();
    expect(viewer.restored).toEqual([{ plugin: 'Y Line', theme: 'Pro Light' }]);
    hash = withEditedSql(hash, 'SELECT 1');
    hashChanged.fire();
    await settle();
    expect(viewer.restored).toEqual([{ plugin: 'Datagrid', group_by: ['host'], theme: 'Pro Light' }]);
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
    expect(el.querySelector('.d-explore-view__body .d-notice--error')!.textContent).toBe('500 Code: 47. Unknown identifier host');
  });

  it('offers the deepest group value of a clicked row on a column of the rows, no time, at the pointer', async () => {
    open();
    await settle();
    viewer.dispatchEvent(new MouseEvent('pointerdown', { clientX: 30, clientY: 40 }));
    const click = (filter: unknown[]) => viewer.dispatchEvent(new CustomEvent('perspective-click', { detail: { config: { filter } } }));
    click([['time', '==', 1], ['status', '==', 500], ['host', '==', 'a']]);
    click([['time', '==', 1]]);
    click([]);
    expect(offered).toEqual([{ at: { x: 30, y: 40 }, candidates: [{ fieldId: 'host', value: 'a' }] }]);
  });

  it('offers nothing from an edited query’s rows, whose columns the page’s filters do not reach', async () => {
    hash = withEditedSql(hash, 'SELECT customer_project FROM http_logs');
    schema = { customer_project: 'string' };
    open();
    await settle();
    viewer.dispatchEvent(new CustomEvent('perspective-click', { detail: { config: { filter: [['customer_project', '==', 'sandstorm.shop']] } } }));
    expect(offered).toEqual([]);
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

describe('editedSql and withEditedSql', () => {
  it('read and write the edited SQL of the tab’s hash, keeping its other keys', () => {
    expect(editedSql('#explore=3')).toBeUndefined();
    const edited = withEditedSql('#explore=3', "SELECT * FROM t WHERE a = 'x&y' # z");
    expect(editedSql(edited)).toBe("SELECT * FROM t WHERE a = 'x&y' # z");
    expect(withEditedSql(edited, undefined)).toBe('#explore=3');
  });
});

describe('persistable', () => {
  it('leaves out the table’s name, the theme and the title', () => {
    expect(persistable({ plugin: 'Y Bar', table: 't1', theme: 'Pro Dark', title: 'x', settings: true })).toEqual({ plugin: 'Y Bar', settings: true });
  });
});
