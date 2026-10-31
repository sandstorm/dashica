// @vitest-environment jsdom
// Tests for exploreView in explore-view.ts: the chart menu's entry, the view as the page's hash over the content,
// Close, the widget found in the page's tree.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, WidgetNode } from '../../generated/zz_generated.dashica';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import type { Selection, WidgetMenuContext } from '../../hosts/widgets/widgets';
import { exploreView, findWidget } from './explore-view';

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
let navigated: string[];
let over: HTMLElement[];
let pageChanged: EventEmitter<PageJson>;
let query: QueryHost;
let subscriptions: { dispose(): unknown }[];
let selections: Selection[];

beforeEach(() => {
  history.replaceState(null, '', '/p/shop?time=1h');
  menuItems = [];
  navigated = [];
  over = [];
  selections = [];
  pageChanged = new EventEmitter<PageJson>();
  query = new QueryHost(window);
  subscriptions = [];
  vi.stubGlobal('fetch', async () => new Response('rows'));
  const context = {
    subscriptions,
    globalState: { get: (_key: string, defaultValue?: unknown) => defaultValue, update: async () => {} },
    query,
    page: { current: page, onDidChangePage: pageChanged.event, navigate: async (url: string) => void navigated.push(url) },
    widgets: { select: (selection: Selection) => selections.push(selection) },
    ui: {
      registerMenuItem: (menuId: string, item: { title?: string; when?: (context: WidgetMenuContext) => boolean }) => {
        menuItems.push({ menuId, ...item });
        return new Disposable(() => {});
      },
      showOverContent: (element: HTMLElement) => {
        over.push(element);
        document.body.append(element);
        return new Disposable(() => {
          over.splice(over.indexOf(element), 1);
          element.remove();
        });
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

const goTo = (hash: string) => {
  history.replaceState(null, '', `/p/shop?time=1h${hash}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
};

describe('exploreView', () => {
  it('is in the menu of a chart with rows, not of one without', () => {
    expect(menuItems.map(({ menuId, title }) => ({ menuId, title }))).toEqual([{ menuId: 'widget/context', title: 'Open in Explore view' }]);
    const when = menuItems[0].when!;
    expect(when({ widget: chart, url: () => '', lastResult: undefined })).toBe(true);
    expect(when({ widget: { type: 'alertOverview', props: {}, dataUrl: '/p/shop/api/1' } as WidgetNode, url: () => '', lastResult: undefined })).toBe(false);
  });

  it('opens the view as the page’s hash', async () => {
    await run({ widget: chart, url: () => '', lastResult: undefined });
    expect(navigated).toEqual(['#explore=3']);
  });

  it('lays the view of the hash’s chart over the content, and takes it away when the hash goes', () => {
    goTo('#explore=3');
    expect(over).toHaveLength(1);
    expect(over[0].querySelector('.d-explore-view__title')!.textContent).toBe('Explore: By status');
    goTo('#w=3');
    expect(over).toHaveLength(0);
  });

  it('opens the view of a link once the page is shown, and none for a chart the page lacks', () => {
    history.replaceState(null, '', '/p/shop#explore=3');
    pageChanged.fire(page);
    expect(over).toHaveLength(1);
    pageChanged.fire(page);
    expect(over).toHaveLength(1);
    goTo('#explore=9');
    expect(over).toHaveLength(0);
  });

  it('goes to the chart on Close', () => {
    goTo('#explore=3');
    over[0].querySelector<HTMLButtonElement>('[data-testid="explore-view-close"]')!.click();
    expect(navigated).toEqual(['#w=3']);
  });
});

describe('findWidget', () => {
  it('finds the widget by the id in its dataUrl among the children', () => {
    expect(findWidget(page.widgets, '3')).toBe(chart);
    expect(findWidget(page.widgets, '4')).toBeUndefined();
  });
});
