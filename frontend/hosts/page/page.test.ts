// @vitest-environment jsdom
// Tests for page.ts: the first page, navigate, links, back and forward, a hash on the page, a page that cannot be shown;
// the tabs: opening, switching, closing, the address bar and history following the active tab, a background tab kept
// and asked nothing, a switch to a tab without a page, a closed tab's query state disposed, a page kind named in the hash, the
// tabs after a reload, a URL without `page.json`; a popped-out view in a tab of its own, kept in memory only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { Memento } from '../extension-host/extension-host';
import { TEST_TIME } from '../query/query-testing';
import { settle } from '../widgets/widgets-testing';
import type { PageContext } from './page';
import { PageHost } from './page';

let content: HTMLElement;
let host: PageHost;
/** The pages the server has, by path. */
let pages: Record<string, PageJson>;
let rendered: string[];
/** The context of each page rendered, by title. */
let contexts: Record<string, PageContext>;
/** What the host keeps for the session, as the sessionStorage would. */
let stored: Map<string, unknown>;

function page(title: string, defaultTime?: string): PageJson {
  return { kind: 'dashboard', title, defaultTime, filterBar: false, filterButtons: [], widgets: [] };
}

const memento = (): Memento => ({
  get: <T>(key: string, defaultValue?: T) => (stored.has(key) ? structuredClone(stored.get(key)) : defaultValue) as T,
  update: async (key: string, value: unknown) => void stored.set(key, value),
});

function createHost(browserWindow: Window = window): PageHost {
  const created = new PageHost(browserWindow, { menu: [], explore: false, sqlEnabled: false, connections: [] }, content, memento());
  created.registerPageRenderer('dashboard', (el, shown, context) => {
    el.textContent = shown.title;
    rendered.push(shown.title);
    contexts[shown.title] = context;
    return new Disposable(() => rendered.push(`disposed ${shown.title}`));
  });
  // a key every chart sends, kept per page: a page opens in its own default
  created.activeQuery.get(TEST_TIME);
  return created;
}

/** The active tab's time range (`1h`). */
const timeRange = () => host.activeQuery.get(TEST_TIME);

const setTimeRange = (range: string) => host.activeQuery.set(TEST_TIME, range);

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  pages = { '/p/shop/page.json': page('Shop', '168h'), '/p/checkout/page.json': page('Checkout') };
  rendered = [];
  contexts = {};
  stored = new Map();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const shown = pages[url];
      return shown ? new Response(JSON.stringify(shown)) : new Response('404 page not found', { status: 404 });
    }),
  );
  content = document.body.appendChild(document.createElement('main'));
  host = createHost();
});

afterEach(() => {
  host.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

/** The host after a reload at `url`. */
function reloadAt(url: string): void {
  host.dispose();
  history.replaceState(null, '', url);
  host = createHost();
}

/** `window` with `location.assign` as `assign` (jsdom cannot leave the page). */
function windowAssigning(assign: (url: string) => void): Window {
  const bound = (target: object, key: string | symbol) => {
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  // `location.assign` cannot be replaced, not even by a Proxy: what the page host reads of `location`, and `assign`
  const browserLocation = {
    get href() {
      return location.href;
    },
    get origin() {
      return location.origin;
    },
    get pathname() {
      return location.pathname;
    },
    get search() {
      return location.search;
    },
    assign,
  };
  return new Proxy(window, { get: (target, key) => (key === 'location' ? browserLocation : bound(target, key)) });
}

/** The text of the tab shown. */
const shownText = () => [...content.children].find((el) => !(el as HTMLElement).hidden)?.textContent;
const address = () => location.pathname + location.search + location.hash;
const fetched = () => vi.mocked(fetch).mock.calls.map(([url]) => url);
/** Goes back one entry and waits for the browser's `popstate`. */
async function back(): Promise<void> {
  const went = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
  history.back();
  await went;
  await settle();
}

describe('PageHost', () => {
  it('starts with the page of the URL, in its own time range', async () => {
    const changes: (string | undefined)[] = [];
    host.onDidChangePage((shown) => changes.push(shown?.title));
    await host.start();
    expect(shownText()).toBe('Shop');
    expect(host.current?.title).toBe('Shop');
    expect(timeRange()).toBe('168h');
    expect(document.title).toBe('Shop · Dashica');
    expect(changes).toEqual(['Shop']);
    expect(host.tabs).toEqual([{ id: host.activeTab.id, url: '/p/shop', title: 'Shop' }]);
    expect(history.state).toEqual({ tab: host.activeTab.id });
  });

  it('navigates as a new history entry, taking the page shown down first; the target opens in its own time range', async () => {
    await host.start();
    setTimeRange('1h');
    await host.navigate('/p/checkout');
    expect(location.pathname).toBe('/p/checkout');
    expect(shownText()).toBe('Checkout');
    expect(rendered).toEqual(['Shop', 'disposed Shop', 'Checkout']);
    expect(timeRange()).toBe('24h');
    expect(host.activeTab.title).toBe('Checkout');
  });

  it('goes to a hash on the page shown without loading it again, keeping its query state, and tells the page', async () => {
    await host.start();
    setTimeRange('1h');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const hashes: string[] = [];
    contexts.Shop.onDidChangeHash(() => hashes.push(contexts.Shop.hash));
    await host.navigate('/p/shop#w=3');
    expect(address()).toBe('/p/shop?time=1h#w=3');
    expect(host.activeTab.url).toBe('/p/shop?time=1h#w=3');
    expect(hashes).toEqual(['#w=3']);
    await host.navigate('/p/shop#w=3');
    expect(hashes).toEqual(['#w=3', '#w=3']);
    expect(rendered).toEqual(['Shop']);
    expect(timeRange()).toBe('1h');
  });

  it('tells the page of a change of only the hash by the browser (a link, back and forward), querying nothing again', async () => {
    await host.start();
    setTimeRange('1h');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const before = fetched().length;
    let refreshes = 0;
    host.activeQuery.onDidRequestRefresh(() => refreshes++);
    const hashes: string[] = [];
    contexts.Shop.onDidChangeHash(() => hashes.push(contexts.Shop.hash));
    history.pushState(null, '', '#w=3');
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(history.state).toEqual({ tab: host.activeTab.id });
    await back();
    expect(location.hash).toBe('');
    expect(hashes).toEqual(['#w=3', '']);
    expect(fetched().length).toBe(before);
    expect(refreshes).toBe(0);
    expect(rendered).toEqual(['Shop']);
    expect(timeRange()).toBe('1h');
  });

  it('goes to a hash on the page shown when the page asked for before has not loaded yet', async () => {
    await host.start();
    let respond!: () => void;
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (respond = () => resolve(new Response(JSON.stringify(page('Checkout')))))));
    const toCheckout = host.navigate('/p/checkout');
    await host.navigate('/p/shop#w=3');
    respond();
    await toCheckout;
    expect(address()).toBe('/p/shop#w=3');
    expect(rendered).toEqual(['Shop']);
  });

  it('opens a link to another page in the active tab', async () => {
    await host.start();
    const link = content.appendChild(document.createElement('a'));
    link.href = '/p/checkout';
    link.click();
    await settle();
    expect(location.pathname).toBe('/p/checkout');
    expect(shownText()).toContain('Checkout');
    expect(host.tabs).toHaveLength(1);
  });

  it('leaves a link with a target or a modifier key to the browser', async () => {
    await host.start();
    const link = content.appendChild(document.createElement('a'));
    link.href = '/p/checkout';
    link.target = '_blank';
    link.click();
    link.removeAttribute('target');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    await settle();
    expect(location.pathname).toBe('/p/shop');
  });

  it('goes back to the page before; on the same page, back only takes its query state from the URL', async () => {
    await host.start();
    await host.navigate('/p/shop?time=1h');
    expect(timeRange()).toBe('1h');
    history.replaceState(history.state, '', '/p/shop?time=6h');
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    expect(timeRange()).toBe('6h');
    expect(rendered).toEqual(['Shop', 'disposed Shop', 'Shop']);

    history.replaceState(history.state, '', '/p/checkout');
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    await settle();
    expect(shownText()).toBe('Checkout');
  });

  it('puts a change of the query state into the tab’s URL and the address bar as a new entry, keeping the hash', async () => {
    reloadAt('/p/shop#w=3');
    await host.start();
    const entries = history.length;
    setTimeRange('1h');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(address()).toBe('/p/shop?time=1h#w=3');
    expect(host.activeTab.url).toBe('/p/shop?time=1h#w=3');
    expect(history.length).toBe(entries + 1);
    expect(history.state).toEqual({ tab: host.activeTab.id });
  });

  it('shows a page it cannot load in the tab', async () => {
    reloadAt('/p/gone');
    await host.start();
    expect(content.querySelector('.d-notice--error')!.textContent).toContain('/p/gone: 404');
    expect(host.current).toBeUndefined();
    expect(host.activeTab.title).toBe('/p/gone');
  });

  it('shows a page of a kind without renderer in the tab', async () => {
    pages['/p/shop/page.json'] = { ...page('Docs'), kind: 'docs' };
    await host.start();
    expect(content.querySelector('.d-notice--error')!.textContent).toBe('no renderer for the page kind docs');
  });

  describe('tabs', () => {
    it('opens a page in a new tab after the active one as a new entry, keeping the tab before rendered and hidden', async () => {
      await host.start();
      const shop = host.activeTab;
      const shopElement = content.children[0] as HTMLElement;
      const entries = history.length;
      const changes: (string | undefined)[] = [];
      host.onDidChangePage((shown) => changes.push(shown?.title));
      await host.navigate('/p/checkout?time=1h', { newTab: true });
      expect(host.tabs.map((tab) => tab.title)).toEqual(['Shop', 'Checkout']);
      expect(host.activeTab.url).toBe('/p/checkout?time=1h');
      expect(address()).toBe('/p/checkout?time=1h');
      expect(history.length).toBe(entries + 1);
      expect(history.state).toEqual({ tab: host.activeTab.id });
      expect(document.title).toBe('Checkout · Dashica');
      expect(shownText()).toBe('Checkout');
      expect(shopElement.hidden).toBe(true);
      expect(shopElement.textContent).toBe('Shop');
      expect(rendered).toEqual(['Shop', 'Checkout']);
      expect(timeRange()).toBe('1h');
      // none while it loads, then its page
      expect(changes).toEqual([undefined, 'Checkout']);
      expect(host.tabs[0]).toEqual(shop);
    });

    it('shows the tab with the same URL instead of opening another', async () => {
      await host.start();
      await host.navigate('/p/checkout', { newTab: true });
      await host.navigate('/p/shop', { newTab: true });
      expect(host.tabs).toHaveLength(2);
      expect(host.activeTab.title).toBe('Shop');
      expect(rendered).toEqual(['Shop', 'Checkout']);
    });

    it('switches tabs in place of the entry shown, the page and the query state each tab’s own', async () => {
      await host.start();
      setTimeRange('1h');
      await new Promise((resolve) => setTimeout(resolve, 250));
      await host.navigate('/p/checkout', { newTab: true });
      const entries = history.length;
      const changes: (string | undefined)[] = [];
      host.onDidChangePage((shown) => changes.push(shown?.title));
      host.showTab(host.tabs[0].id);
      expect(history.length).toBe(entries);
      expect(address()).toBe('/p/shop?time=1h');
      expect(host.current?.title).toBe('Shop');
      expect(timeRange()).toBe('1h');
      expect(shownText()).toBe('Shop');
      expect(changes).toEqual(['Shop']);
      expect(rendered).toEqual(['Shop', 'Checkout']);
    });

    it('tells of a switch to a tab without a page: one that could not be loaded, one that is loading', async () => {
      await host.start();
      await host.navigate('/p/gone', { newTab: true });
      expect(host.current).toBeUndefined();
      const [shop, gone] = host.tabs;
      const changes: (string | undefined)[] = [];
      host.onDidChangePage((shown) => changes.push(shown?.title));
      host.showTab(shop.id);
      host.showTab(gone.id);
      expect(changes).toEqual(['Shop', undefined]);
      expect(host.current).toBeUndefined();

      let respond!: () => void;
      vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (respond = () => resolve(new Response('', { status: 500 })))));
      host.showTab(shop.id);
      const failing = host.navigate('/p/checkout');
      host.showTab(gone.id);
      host.showTab(shop.id);
      expect(changes).toEqual(['Shop', undefined, 'Shop', undefined, 'Shop']);
      respond();
      await failing;
      expect(changes).toEqual(['Shop', undefined, 'Shop', undefined, 'Shop', undefined]);
    });

    it('shows the tab before on Back after opening one; the opened one stays', async () => {
      await host.start();
      await host.navigate('/p/checkout', { newTab: true });
      await back();
      expect(host.activeTab.title).toBe('Shop');
      expect(address()).toBe('/p/shop');
      expect(host.tabs).toHaveLength(2);
      expect(rendered).toEqual(['Shop', 'Checkout']);
    });

    it('asks nothing of a background tab on a change of the tab shown', async () => {
      await host.start();
      const shop = host.activeQuery;
      let refreshes = 0;
      shop.onDidRequestRefresh(() => refreshes++);
      await host.navigate('/p/checkout', { newTab: true });
      setTimeRange('1h');
      host.activeQuery.refresh();
      expect(refreshes).toBe(0);
    });

    it('closes a tab: its page taken down, the tab shown before active in place of the entry', async () => {
      await host.start();
      await host.navigate('/p/checkout', { newTab: true });
      const checkout = host.activeTab.id;
      const entries = history.length;
      host.closeTab(checkout);
      expect(host.tabs.map((tab) => tab.title)).toEqual(['Shop']);
      expect(address()).toBe('/p/shop');
      expect(history.length).toBe(entries);
      expect(rendered).toEqual(['Shop', 'Checkout', 'disposed Checkout']);
      expect(content.children).toHaveLength(1);
      host.closeTab(host.activeTab.id);
      expect(host.tabs).toHaveLength(1);
    });

    it('closes a tab’s query state with it: its refresh reaches nobody any more', async () => {
      await host.start();
      await host.navigate('/p/checkout', { newTab: true });
      const checkout = host.activeQuery;
      let refreshes = 0;
      checkout.onDidRequestRefresh(() => refreshes++);
      host.closeTab(host.activeTab.id);
      checkout.refresh();
      expect(refreshes).toBe(0);
    });

    it('closes its own tab from the page (`context.close`)', async () => {
      await host.start();
      await host.navigate('/p/checkout', { newTab: true });
      contexts.Checkout.close();
      expect(host.tabs.map((tab) => tab.title)).toEqual(['Shop']);
    });

    it('opens a closed tab again with its id on Back', async () => {
      await host.start();
      await host.navigate('/p/checkout', { newTab: true });
      const checkout = host.activeTab.id;
      await host.navigate('/p/shop?time=1h');
      host.closeTab(checkout);
      expect(host.tabs).toHaveLength(1);
      await back();
      expect(host.activeTab).toEqual({ id: checkout, url: '/p/checkout', title: 'Checkout' });
      expect(host.tabs).toHaveLength(2);
    });

    it('renders a tab whose hash names a registered kind by that kind’s renderer, its title the renderer’s', async () => {
      const explored: string[] = [];
      host.registerPageRenderer('explore', (el, shown, context) => {
        el.textContent = `explore ${context.hash}`;
        explored.push(context.hash);
        return { dispose: () => explored.push('disposed'), title: `Explore: ${shown.title}` };
      });
      await host.start();
      await host.navigate('/p/shop#explore=3', { newTab: true });
      expect(shownText()).toBe('explore #explore=3');
      expect(host.activeTab.title).toBe('Explore: Shop');
      expect(host.tabs).toHaveLength(2);
      await host.navigate('/p/shop#explore=4');
      expect(explored).toEqual(['#explore=3', 'disposed', '#explore=4']);
      await host.navigate('/p/shop#w=4');
      expect(explored).toEqual(['#explore=3', 'disposed', '#explore=4', 'disposed']);
      expect(shownText()).toBe('Shop');
      expect(host.activeTab.title).toBe('Shop');
    });

    it('renders by the page’s kind for a hash that names no kind', async () => {
      reloadAt('/p/shop#explore=3');
      await host.start();
      expect(shownText()).toBe('Shop');
    });

    it('keeps the tabs over a reload, the background ones unloaded until shown', async () => {
      await host.start();
      await host.navigate('/p/checkout', { newTab: true });
      const [shop, checkout] = host.tabs;
      host.dispose();
      content.replaceChildren();
      vi.mocked(fetch).mockClear();

      host = createHost();
      await host.start();
      expect(host.tabs).toEqual([shop, checkout]);
      expect(host.activeTab.id).toBe(checkout.id);
      expect(fetched()).toEqual(['/p/checkout/page.json']);
      host.showTab(shop.id);
      await settle();
      expect(fetched()).toEqual(['/p/checkout/page.json', '/p/shop/page.json']);
      expect(shownText()).toBe('Shop');
    });

    it('loads a tab restored after a reload once when Back goes to an entry of it at another URL', async () => {
      await host.start();
      await host.navigate('/p/checkout', { newTab: true });
      const checkout = host.activeTab.id;
      await host.navigate('/p/shop?time=1h');
      host.showTab(host.tabs[0].id);
      host.dispose();
      content.replaceChildren();
      host = createHost();
      await host.start();
      vi.mocked(fetch).mockClear();
      // the entry of the checkout tab before it went to /p/shop?time=1h
      history.pushState({ tab: checkout }, '', '/p/checkout');
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      await settle();
      expect(fetched()).toEqual(['/p/checkout/page.json']);
      expect(host.activeTab).toEqual({ id: checkout, url: '/p/checkout', title: 'Checkout' });
      expect(shownText()).toBe('Checkout');
    });

    it('pops a view out into a new tab after the active one, on the page shown without fetching it again', async () => {
      reloadAt('/p/shop?time=1h');
      await host.start();
      vi.mocked(fetch).mockClear();
      const entries = history.length;
      const views: string[] = [];
      await host.popOut({
        title: 'Debug: Requests',
        render: (el) => {
          el.textContent = 'debug of Requests';
          views.push('rendered');
          return new Disposable(() => views.push('disposed'));
        },
      });
      const popped = host.activeTab;
      expect(host.showsPoppedView).toBe(true);
      expect(host.tabs.map((tab) => tab.title)).toEqual(['Shop', 'Debug: Requests']);
      expect(popped.url).toBe(`/p/shop?time=1h#view=${popped.id}`);
      expect(address()).toBe(popped.url);
      expect(history.length).toBe(entries + 1);
      expect(shownText()).toBe('debug of Requests');
      expect(host.current?.title).toBe('Shop');
      expect(fetched()).toEqual([]);
      // the page's own renderer is not asked for it
      expect(rendered).toEqual(['Shop']);
      host.closeTab(popped.id);
      expect(views).toEqual(['rendered', 'disposed']);
      expect(shownText()).toBe('Shop');
      expect(host.showsPoppedView).toBe(false);
    });

    it('keeps a popped-out view in memory only: not stored for a reload, its link shows the page', async () => {
      await host.start();
      await host.navigate('/p/checkout', { newTab: true });
      const checkout = host.activeTab;
      await host.popOut({ title: 'Details: Orders', render: (el) => ((el.textContent = 'records'), Disposable.from()) });
      const popped = host.activeTab;
      expect(stored.get('tabs')).toEqual({ tabs: [host.tabs[0], checkout], active: checkout.id });

      host.dispose();
      content.replaceChildren();
      host = createHost();
      await host.start();
      expect(host.tabs.map((tab) => tab.id)).toEqual([host.tabs[0].id, checkout.id]);
      expect(host.activeTab.id).toBe(checkout.id);
      expect(host.activeTab.url).toBe(popped.url);
      // `#view=<id>` names no view in memory: the page shows
      expect(popped.url).toBe(`/p/checkout#view=${popped.id}`);
      expect(shownText()).toBe('Checkout');
      expect(host.showsPoppedView).toBe(false);
    });

    it('leaves a URL without `page.json` to the browser', async () => {
      const assign = vi.fn();
      host.dispose();
      host = createHost(windowAssigning(assign));
      await host.start();
      await host.navigate('/public/report.pdf');
      expect(assign).toHaveBeenCalledWith('/public/report.pdf');
    });

    it('shows a URL without `page.json` that a background tab navigated to in that tab, not in the browser tab', async () => {
      const assign = vi.fn();
      host.dispose();
      host = createHost(windowAssigning(assign));
      await host.start();
      let respond!: () => void;
      vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (respond = () => resolve(new Response('404 page not found', { status: 404 })))));
      const toReport = host.navigate('/public/report.pdf');
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify(page('Checkout'))));
      await host.navigate('/p/checkout', { newTab: true });
      respond();
      await toReport;
      expect(assign).not.toHaveBeenCalled();
      expect(host.activeTab.title).toBe('Checkout');
      expect(host.tabs[0].url).toBe('/public/report.pdf');
      expect(content.querySelector('.d-notice--error')!.textContent).toContain('/public/report.pdf: 404');
    });
  });
});
