// @vitest-environment jsdom
// Tests for exploreView in explore-view.ts: only "Explore" greyed in the global menu while Explore is not enabled, the
// chart menu's entry opening a tab, the view as the page kind `explore` named in the tab's hash, its title, Close, the
// widget found in the page's tree; the global menu's "Explore" and "Start from chart…" opening a blank Explore; Reset's
// confirmation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, WidgetNode } from '../../generated/zz_generated.dashica';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import type { PageContext, PageRenderer } from '../../hosts/page/page';
import { QueryHost } from '../../hosts/query/query';
import type { WidgetMenuContext } from '../../hosts/widgets/widgets';
import { blankExploreUrl, chartsOf, confirmReset, EXPLORE_NOT_ENABLED, exploreUrl, exploreView, findWidget } from './explore-view';

const chart: WidgetNode = {
  type: 'barVertical',
  props: { title: 'By status', x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'requests' } },
  dataUrl: '/p/shop/api/3',
  rowsUrl: '/p/shop/api/3/rows',
  connection: 'logs',
};
const markdown: WidgetNode = { type: 'markdown', props: {} };
const page = { kind: 'dashboard', title: 'Shop', filterBar: true, filterButtons: [], widgets: [{ type: 'grid', props: {}, children: { a: markdown, b: chart } }] } as PageJson;

let menuItems: { menuId: string; title?: string; when?: (context: WidgetMenuContext) => boolean; enabled?: (context: object) => boolean }[];
let commands: Map<string, (context?: WidgetMenuContext) => unknown>;
/** The page the active tab shows; `undefined` while none is. */
let current: PageJson | undefined;
/** What the fake quick pick was shown; it picks the first item. */
let picks: (readonly { label: string; description?: string }[])[];
let navigated: { url: string; newTab?: boolean }[];
let renderers: Map<string, PageRenderer>;
let query: QueryHost;
let subscriptions: { dispose(): unknown }[];
let closed: number;

beforeEach(() => {
  menuItems = [];
  commands = new Map();
  current = page;
  picks = [];
  navigated = [];
  renderers = new Map();
  closed = 0;
  query = new QueryHost();
  query.load({ search: '?time=1h' });
  subscriptions = [];
  vi.stubGlobal('fetch', async () => new Response('rows'));
  activate(true);
});

/** Activates the extension, Explore enabled (`explore`) or not, on fakes that record what it registers. */
function activate(explore: boolean): void {
  const context = {
    subscriptions,
    query,
    globalState: { get: (_key: string, defaultValue?: unknown) => defaultValue, update: async () => {} },
    page: {
      workbench: { menu: [], explore, connections: ['default', 'logs'] },
      get current() {
        return current;
      },
      activeTab: { id: '1', url: '/p/shop?time=1h#w=2', title: 'Shop' },
      navigate: async (url: string, options?: { newTab?: boolean }) => void navigated.push({ url, ...options }),
      registerPageRenderer: (kind: string, renderer: PageRenderer) => (renderers.set(kind, renderer), new Disposable(() => renderers.delete(kind))),
    },
    ui: {
      showQuickPick: async <T extends { label: string }>(items: readonly T[]) => (picks.push(items), items[0]),
      registerMenuItem: (menuId: string, item: { title?: string; when?: (context: WidgetMenuContext) => boolean }) => {
        menuItems.push({ menuId, ...item });
        return new Disposable(() => {});
      },
    },
    commands: {
      registerCommand: (id: string, command: (context?: WidgetMenuContext) => unknown) => (commands.set(id, command), new Disposable(() => commands.delete(id))),
    },
  };
  exploreView.activate(context as unknown as ExtensionContext);
}

afterEach(() => {
  for (const subscription of subscriptions.reverse()) subscription.dispose();
  query.dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** Renders the tab of the page kind `explore` with `hash`, as the page host does. */
function renderTab(hash: string) {
  const el = document.body.appendChild(document.createElement('div'));
  const context: PageContext = { query, hash, onDidChangeHash: new EventEmitter<void>().event, close: () => closed++ };
  return { el, rendered: renderers.get('explore')!(el, page, context) };
}

describe('exploreView', () => {
  it('registers only "Explore" greyed in the global menu while Explore is not enabled: no chart menu entry, no page kind', () => {
    for (const subscription of subscriptions.splice(0).reverse()) subscription.dispose();
    menuItems = [];
    renderers.clear();
    activate(false);
    expect(menuItems).toEqual([{ menuId: 'workbench/global', ...EXPLORE_NOT_ENABLED }]);
    expect(EXPLORE_NOT_ENABLED).toMatchObject({ title: 'Explore', tooltip: 'Explore is not enabled (explore.enabled)' });
    expect(EXPLORE_NOT_ENABLED.enabled!({})).toBe(false);
    expect(renderers.size).toBe(0);
  });

  it('is in the menu of a chart with rows, not of one without', () => {
    const chartMenu = menuItems.filter(({ menuId }) => menuId === 'widget/context');
    expect(chartMenu.map(({ title }) => title)).toEqual(['Open in Explore view']);
    const when = chartMenu[0].when!;
    expect(when({ widget: chart, url: () => '', lastResult: undefined })).toBe(true);
    expect(when({ widget: { type: 'alertOverview', props: {}, dataUrl: '/p/shop/api/1' } as WidgetNode, url: () => '', lastResult: undefined })).toBe(false);
  });

  it('opens the view in a new tab: the active tab’s URL with the hash #explore=<id>', async () => {
    await commands.get('exploreView.openWidget')!({ widget: chart, url: () => '', lastResult: undefined });
    expect(navigated).toEqual([{ url: '/p/shop?time=1h#explore=3', newTab: true }]);
  });

  it('renders the tab of the kind explore: the view of the hash’s chart, titled after it, with the tab’s query state', async () => {
    const { el, rendered } = renderTab('#explore=3');
    expect([...el.children].map((child) => child.className)).toEqual(['d-explore-view__host']);
    expect(el.querySelector('.d-explore-view__title')!.textContent).toBe('Explore: By status');
    expect(rendered.title).toBe('Explore: By status');
    rendered.dispose();
    expect(el.children).toHaveLength(0);
  });

  it('puts "Explore" and "Start from chart…" into the global menu, the second greyed without a chart on the shown page', () => {
    const global = menuItems.filter(({ menuId }) => menuId === 'workbench/global');
    expect(global.map(({ title }) => title)).toEqual(['Explore', 'Start from chart…']);
    expect(global[0].enabled).toBeUndefined();
    expect(global[1].enabled!({})).toBe(true);
    current = { ...page, widgets: [markdown] };
    expect(global[1].enabled!({})).toBe(false);
    current = undefined;
    expect(global[1].enabled!({})).toBe(false);
  });

  it('opens a blank Explore in a new tab on the connection of the shown page’s first chart, else the first connection', async () => {
    await commands.get('exploreView.open')!();
    current = undefined;
    await commands.get('exploreView.open')!();
    expect(navigated).toEqual([
      { url: '/p/shop?time=1h#explore=&connection=logs', newTab: true },
      { url: '/p/shop?time=1h#explore=&connection=default', newTab: true },
    ]);
  });

  it('starts from a picked chart: a blank Explore on its connection with its SQL and parameters for the tab’s query state', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => (asked.push(url), Response.json({ sql: 'SELECT {__from:DateTime64}', parameters: { __from: '1' } })));
    await commands.get('exploreView.startFromChart')!();
    expect(picks).toEqual([[expect.objectContaining({ label: 'By status', description: 'logs' })]]);
    expect(asked).toEqual(['/p/shop/api/3/sql?time=1h']);
    expect(navigated).toEqual([{ url: '/p/shop?time=1h#explore=&connection=logs&exploreSql=SELECT+%7B__from%3ADateTime64%7D&param___from=1', newTab: true }]);
  });

  it('renders a blank Explore for the hash #explore= alone, titled "Explore", with a connection picker', () => {
    const { el, rendered } = renderTab('#explore=&connection=logs');
    expect(rendered.title).toBe('Explore');
    expect(el.querySelector<HTMLSelectElement>('[data-testid="explore-view-connection"]')!.value).toBe('logs');
  });

  it('refuses a hash naming a chart the page lacks, which the tab shows as its error', () => {
    expect(() => renderTab('#explore=9')).toThrow('Shop has no chart 9 to explore');
  });

  it('closes its tab on Close', () => {
    const { el } = renderTab('#explore=3');
    el.querySelector<HTMLButtonElement>('[data-testid="explore-view-close"]')!.click();
    expect(closed).toBe(1);
  });
});

describe('exploreUrl', () => {
  it('replaces the hash of a tab’s URL, keeping its path and query', () => {
    expect(exploreUrl('/p/shop?time=1h&f=host:eq:a#w=2', '3')).toBe('/p/shop?time=1h&f=host:eq:a#explore=3');
    expect(exploreUrl('/p/shop', 'a b')).toBe('/p/shop#explore=a%20b');
  });
});

describe('blankExploreUrl', () => {
  it('replaces the hash of a tab’s URL by a blank Explore on the connection, with an edited query when given', () => {
    expect(blankExploreUrl('/p/shop?time=1h#w=2', 'logs')).toBe('/p/shop?time=1h#explore=&connection=logs');
    expect(blankExploreUrl('/', 'default', { sql: 'SELECT 1', parameters: { v: 'a' } })).toBe('/#explore=&connection=default&exploreSql=SELECT+1&param_v=a');
  });
});

describe('chartsOf', () => {
  it('lists the charts with rows among the children, in page order', () => {
    expect(chartsOf(page.widgets)).toEqual([chart]);
    expect(chartsOf([markdown])).toEqual([]);
  });
});

describe('findWidget', () => {
  it('finds the widget by the id in its dataUrl among the children', () => {
    expect(findWidget(page.widgets, '3')).toBe(chart);
    expect(findWidget(page.widgets, '4')).toBeUndefined();
  });
});

describe('confirmReset', () => {
  /** A quick pick that records its items and options and picks the item labelled `label` (none: hidden without). */
  const pickLabelled = (label: string | undefined, shown: unknown[]) => ({
    showQuickPick: async <T extends { label: string }>(items: readonly T[], options?: unknown) => (shown.push({ items, options }), items.find((item) => item.label === label)),
  });

  it('asks below the button, Reset or Cancel, and says yes only to Reset', async () => {
    const button = document.createElement('button');
    const shown: { items: { label: string }[]; options: { anchor: unknown } }[] = [];
    expect(await confirmReset(pickLabelled('Reset', shown) as never, button)).toBe(true);
    expect(shown[0].items.map((item) => item.label)).toEqual(['Reset', 'Cancel']);
    expect(shown[0].options.anchor).toBe(button);
    expect(await confirmReset(pickLabelled('Cancel', shown) as never, button)).toBe(false);
    expect(await confirmReset(pickLabelled(undefined, shown) as never, button)).toBe(false);
  });
});
