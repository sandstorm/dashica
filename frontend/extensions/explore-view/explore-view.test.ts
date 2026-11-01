// @vitest-environment jsdom
// Tests for exploreView in explore-view.ts: only "Explore" greyed in the global menu while Explore is not enabled, the
// chart menu's entry opening a tab, the view as the page kind `explore` named in the tab's hash, its title, Close, the
// widget found in the page's tree; the global menu's "Explore (from scratch)" and "Explore (from chart…)" opening a
// blank Explore; Reset's confirmation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, WidgetNode, WorkbenchJson } from '../../generated/zz_generated.dashica';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import type { PageContext, PageRenderer } from '../../hosts/page/page';
import { QueryHost } from '../../hosts/query/query';
import { QuickPickItemKind } from '../../hosts/ui/ui';
import type { CommandOptions } from '../../hosts/commands/commands';
import { TIME } from '../time-library/time-state';
import type { WidgetMenuContext } from '../../hosts/widgets/widgets';
import { blankExploreUrl, chartsOf, confirmReset, EXPLORE_NOT_ENABLED, exploreUrl, exploreView, findWidget, menuCharts } from './explore-view';

const chart: WidgetNode = {
  type: 'barVertical',
  props: { title: 'By status', x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'requests' } },
  dataUrl: '/p/shop/api/3',
  rowsUrl: '/p/shop/api/3/rows',
  connection: 'logs',
};
const markdown: WidgetNode = { type: 'markdown', props: {} };
const page = { kind: 'dashboard', title: 'Shop', filterBar: true, filterButtons: [], widgets: [{ type: 'grid', props: {}, children: { a: markdown, b: chart } }] } as PageJson;

/** `workbench.json`'s menu: the shop's chart with rows and an alert overview without, the billing's in a group. */
let menu: WorkbenchJson['menu'];
let menuItems: { menuId: string; command: string; title?: string; when?: (context: WidgetMenuContext) => boolean }[];
let commands: Map<string, (context?: WidgetMenuContext) => unknown>;
/** The options each command was registered with. */
let options: Map<string, CommandOptions | undefined>;
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
  menu = [
    { title: 'Billing', entries: [{ title: 'Billing overview', url: '/p/billing', outline: [{ dataUrl: '/p/billing/api/1', rowsUrl: '/p/billing/api/1/rows', title: 'Invoices', group: 'Details' }] }] },
    {
      title: 'Shop',
      entries: [
        {
          title: 'Shop overview',
          url: '/p/shop',
          outline: [
            { dataUrl: '/p/shop/api/1', title: 'Open alerts', group: '' },
            { dataUrl: '/p/shop/api/3', rowsUrl: '/p/shop/api/3/rows', title: 'By status', group: '' },
          ],
        },
      ],
    },
  ];
  menuItems = [];
  commands = new Map();
  options = new Map();
  current = page;
  picks = [];
  navigated = [];
  renderers = new Map();
  closed = 0;
  query = new QueryHost();
  // sent along, declared as by the time-range extension
  query.declare(TIME);
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
      workbench: { menu, explore, connections: ['default', 'logs'] },
      get current() {
        return current;
      },
      activeTab: { id: '1', url: '/p/shop?time=1h#w=2', title: 'Shop' },
      navigate: async (url: string, options?: { newTab?: boolean }) => void navigated.push({ url, ...options }),
      registerPageRenderer: (kind: string, renderer: PageRenderer) => (renderers.set(kind, renderer), new Disposable(() => renderers.delete(kind))),
    },
    ui: {
      showQuickPick: async <T extends { label: string }>(items: readonly T[]) => (picks.push(items), items[0]),
      registerMenuItem: (menuId: string, item: { command: string; title?: string; when?: (context: WidgetMenuContext) => boolean }) => {
        menuItems.push({ menuId, ...item });
        return new Disposable(() => {});
      },
    },
    commands: {
      registerCommand: (id: string, command: (context?: WidgetMenuContext) => unknown, given?: CommandOptions) => {
        commands.set(id, command);
        options.set(id, given);
        return new Disposable(() => commands.delete(id));
      },
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
  const tabContainer = document.body.appendChild(document.createElement('div'));
  const context: PageContext = { query, hash, onDidChangeHash: new EventEmitter<void>().event, close: () => closed++ };
  return { tabContainer, rendered: renderers.get('explore')!(tabContainer, page, context) };
}

describe('exploreView', () => {
  it('registers only "Explore" greyed in the global menu while Explore is not enabled: no chart menu entry, no page kind', () => {
    for (const subscription of subscriptions.splice(0).reverse()) subscription.dispose();
    menuItems = [];
    renderers.clear();
    activate(false);
    expect(menuItems).toEqual([{ menuId: 'workbench/global', command: 'exploreView.open', title: 'Explore (from scratch)', group: 'explore' }]);
    // greyed: its command is never enabled, its hover says why
    expect([...commands.keys()]).toEqual(['exploreView.open']);
    expect(options.get('exploreView.open')).toBe(EXPLORE_NOT_ENABLED);
    expect([EXPLORE_NOT_ENABLED.enablement!(), EXPLORE_NOT_ENABLED.disabledReason]).toEqual([false, 'Explore is not enabled (explore_enabled)']);
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
    const { tabContainer, rendered } = renderTab('#explore=3');
    expect([...tabContainer.children].map((childElement) => childElement.className)).toEqual(['d-explore-view__host']);
    expect(tabContainer.querySelector('.d-explore-view__title')!.textContent).toBe('Explore: By status');
    expect(rendered.title).toBe('Explore: By status');
    rendered.dispose();
    expect(tabContainer.children).toHaveLength(0);
  });

  it('puts "Explore (from scratch)" and "Explore (from chart…)" into the global menu, the second’s command enabled only while a dashboard has a chart', () => {
    const global = menuItems.filter(({ menuId }) => menuId === 'workbench/global');
    expect(global.map(({ title, command }) => [title, command])).toEqual([
      ['Explore (from scratch)', 'exploreView.open'],
      ['Explore (from chart…)', 'exploreView.startFromChart'],
    ]);
    expect(options.get('exploreView.open')).toBeUndefined();
    const startFromChart = options.get('exploreView.startFromChart')!;
    expect([startFromChart.enablement!(), startFromChart.disabledReason]).toEqual([true, 'No dashboard has a chart']);
    current = undefined;
    expect(startFromChart.enablement!()).toBe(true);
    menu = [{ title: 'Shop', entries: [{ title: 'Shop overview', url: '/p/shop', outline: [{ dataUrl: '/p/shop/api/1', title: 'Open alerts', group: '' }] }] }];
    for (const subscription of subscriptions.splice(0).reverse()) subscription.dispose();
    activate(true);
    expect(options.get('exploreView.startFromChart')!.enablement!()).toBe(false);
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

  it('starts from a picked chart of any dashboard, the shown one’s first: a blank Explore on the connection its /sql answers, with its SQL and parameters for the tab’s query state', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => (asked.push(url), Response.json({ connection: 'audit', sql: 'SELECT {__from:DateTime64}', parameters: { __from: '1' } })));
    await commands.get('exploreView.startFromChart')!();
    expect(picks.map((items) => items.map(({ label, description }) => [label, description]))).toEqual([
      [
        ['By status', 'Shop overview'],
        ['Invoices', 'Billing overview › Details'],
      ],
    ]);
    expect(asked).toEqual(['/p/shop/api/3/sql?time=1h']);
    expect(navigated).toEqual([{ url: '/p/shop?time=1h#explore=&connection=audit&exploreSql=SELECT+%7B__from%3ADateTime64%7D&param___from=1', newTab: true }]);
  });

  it('starts from a picked chart that did not run with an empty editor on its connection', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ connection: 'logs', sql: '', parameters: {} }));
    await commands.get('exploreView.startFromChart')!();
    expect(navigated).toEqual([{ url: '/p/shop?time=1h#explore=&connection=logs', newTab: true }]);
  });

  it('renders a blank Explore for the hash #explore= alone, titled "Explore", with a connection picker', () => {
    const { tabContainer, rendered } = renderTab('#explore=&connection=logs');
    expect(rendered.title).toBe('Explore');
    expect(tabContainer.querySelector<HTMLSelectElement>('[data-testid="explore-view-connection"]')!.value).toBe('logs');
  });

  it('refuses a hash naming a chart the page lacks, which the tab shows as its error', () => {
    expect(() => renderTab('#explore=9')).toThrow('Shop has no chart 9 to explore');
  });

  it('closes its tab on Close', () => {
    const { tabContainer } = renderTab('#explore=3');
    tabContainer.querySelector<HTMLButtonElement>('[data-testid="explore-view-close"]')!.click();
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

describe('menuCharts', () => {
  it('lists the charts with rows of every dashboard, the shown one’s first, then the others in menu order', () => {
    expect(menuCharts(menu, '/p/billing').map(({ label, dataUrl }) => [label, dataUrl])).toEqual([
      ['Invoices', '/p/billing/api/1'],
      ['By status', '/p/shop/api/3'],
    ]);
    expect(menuCharts(menu, '/p/other').map(({ label }) => label)).toEqual(['Invoices', 'By status']);
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

  it('asks in a menu below the button, the question its heading, Reset or Cancel, and says yes only to Reset', async () => {
    const buttonElement = document.createElement('button');
    const shown: { items: { label: string; kind?: number }[]; options: { anchor: unknown; menu?: boolean } }[] = [];
    expect(await confirmReset(pickLabelled('Reset', shown) as never, buttonElement)).toBe(true);
    expect(shown[0].items.map((item) => [item.kind, item.label])).toEqual([
      [QuickPickItemKind.Separator, 'Reset the viewer’s config?'],
      [undefined, 'Reset'],
      [undefined, 'Cancel'],
    ]);
    expect([shown[0].options.anchor, shown[0].options.menu]).toEqual([buttonElement, true]);
    expect(await confirmReset(pickLabelled('Cancel', shown) as never, buttonElement)).toBe(false);
    expect(await confirmReset(pickLabelled(undefined, shown) as never, buttonElement)).toBe(false);
  });
});
