// @vitest-environment jsdom
// Tests for exploreView in explore-view.ts: the chart menu's entry opening a tab, the view as the page kind `explore`
// named in the tab's hash, its title, Close, the widget found in the page's tree.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, WidgetNode } from '../../generated/zz_generated.dashica';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import type { PageContext, PageRenderer } from '../../hosts/page/page';
import { QueryHost } from '../../hosts/query/query';
import type { Selection, WidgetMenuContext } from '../../hosts/widgets/widgets';
import { exploreUrl, exploreView, findWidget } from './explore-view';

const chart: WidgetNode = {
  type: 'barVertical',
  props: { title: 'By status', x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'requests' } },
  dataUrl: '/p/shop/api/3',
  rowsUrl: '/p/shop/api/3/rows',
};
const markdown: WidgetNode = { type: 'markdown', props: {} };
const page = { kind: 'dashboard', title: 'Shop', filterBar: true, filterButtons: [], widgets: [{ type: 'grid', props: {}, children: { a: markdown, b: chart } }] } as PageJson;

let menuItems: { menuId: string; title?: string; when?: (context: WidgetMenuContext) => boolean }[];
let run: (context: WidgetMenuContext) => unknown;
let navigated: { url: string; newTab?: boolean }[];
let renderers: Map<string, PageRenderer>;
let query: QueryHost;
let subscriptions: { dispose(): unknown }[];
let selections: Selection[];
let closed: number;

beforeEach(() => {
  menuItems = [];
  navigated = [];
  renderers = new Map();
  selections = [];
  closed = 0;
  query = new QueryHost(window);
  query.load({ search: '?time=1h' });
  subscriptions = [];
  vi.stubGlobal('fetch', async () => new Response('rows'));
  const context = {
    subscriptions,
    globalState: { get: (_key: string, defaultValue?: unknown) => defaultValue, update: async () => {} },
    page: {
      activeTab: { id: '1', url: '/p/shop?time=1h#w=2', title: 'Shop' },
      navigate: async (url: string, options?: { newTab?: boolean }) => void navigated.push({ url, ...options }),
      registerPageRenderer: (kind: string, renderer: PageRenderer) => (renderers.set(kind, renderer), new Disposable(() => renderers.delete(kind))),
    },
    widgets: { select: (selection: Selection) => selections.push(selection) },
    ui: {
      registerMenuItem: (menuId: string, item: { title?: string; when?: (context: WidgetMenuContext) => boolean }) => {
        menuItems.push({ menuId, ...item });
        return new Disposable(() => {});
      },
    },
    commands: { registerCommand: (_id: string, command: typeof run) => ((run = command), new Disposable(() => {})) },
  };
  exploreView.activate(context as unknown as ExtensionContext);
});

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
  it('is in the menu of a chart with rows, not of one without', () => {
    expect(menuItems.map(({ menuId, title }) => ({ menuId, title }))).toEqual([{ menuId: 'widget/context', title: 'Open in Explore view' }]);
    const when = menuItems[0].when!;
    expect(when({ widget: chart, url: () => '', lastResult: undefined })).toBe(true);
    expect(when({ widget: { type: 'alertOverview', props: {}, dataUrl: '/p/shop/api/1' } as WidgetNode, url: () => '', lastResult: undefined })).toBe(false);
  });

  it('opens the view in a new tab: the active tab’s URL with the hash #explore=<id>', async () => {
    await run({ widget: chart, url: () => '', lastResult: undefined });
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

describe('findWidget', () => {
  it('finds the widget by the id in its dataUrl among the children', () => {
    expect(findWidget(page.widgets, '3')).toBe(chart);
    expect(findWidget(page.widgets, '4')).toBeUndefined();
  });
});
