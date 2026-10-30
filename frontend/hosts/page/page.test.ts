// @vitest-environment jsdom
// Tests for page.ts: the first page, navigate, links, back and forward, a hash on the page, a page that cannot be shown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import type { PageJson } from '../../generated/zz_generated.dashica';
import { settle } from '../widgets/widgets-testing';
import { QueryHost } from '../query/query';
import { PageHost } from './page';

let query: QueryHost;
let content: HTMLElement;
let host: PageHost;
/** The pages the server has, by path. */
let pages: Record<string, PageJson>;
let rendered: string[];

function page(title: string, defaultTime?: string): PageJson {
  return { kind: 'dashboard', title, defaultTime, filterBar: false, filterButtons: [], widgets: [] };
}

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  pages = { '/p/shop/page.json': page('Shop', '168h'), '/p/checkout/page.json': page('Checkout') };
  rendered = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const shown = pages[url];
      return shown ? new Response(JSON.stringify(shown)) : new Response('404 page not found', { status: 404 });
    }),
  );
  query = new QueryHost(window);
  content = document.body.appendChild(document.createElement('main'));
  host = new PageHost(window, { menu: [] }, query, content);
  host.registerPageRenderer('dashboard', (el, shown) => {
    el.textContent = shown.title;
    rendered.push(shown.title);
    return new Disposable(() => rendered.push(`disposed ${shown.title}`));
  });
});

afterEach(() => {
  host.dispose();
  query.dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

describe('PageHost', () => {
  it('starts with the page of the URL, in its own time range', async () => {
    const changes: string[] = [];
    host.onDidChangePage((shown) => changes.push(shown.title));
    await host.start();
    expect(content.textContent).toBe('Shop');
    expect(host.current?.title).toBe('Shop');
    expect(query.time.range).toBe('168h');
    expect(document.title).toBe('Shop · Dashica');
    expect(changes).toEqual(['Shop']);
  });

  it('navigates as a new history entry, taking the page shown down first; the target opens in its own time range', async () => {
    await host.start();
    query.time.setRange('1h');
    await host.navigate('/p/checkout');
    expect(location.pathname).toBe('/p/checkout');
    expect(content.textContent).toBe('Checkout');
    expect(rendered).toEqual(['Shop', 'disposed Shop', 'Checkout']);
    expect(query.time.range).toBe('24h');
  });

  it('goes to a hash on the page shown without loading it again, keeping its query state', async () => {
    await host.start();
    query.time.setRange('1h');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const hashes: string[] = [];
    window.addEventListener('hashchange', () => hashes.push(location.hash), { once: true });
    await host.navigate('/p/shop#w=3');
    expect(location.search).toBe('?time=1h');
    expect(location.hash).toBe('#w=3');
    expect(hashes).toEqual(['#w=3']);
    expect(rendered).toEqual(['Shop']);
    expect(query.time.range).toBe('1h');
  });

  it('leaves a change of only the hash by the browser (a link, back and forward) to the page, querying nothing again', async () => {
    await host.start();
    query.time.setRange('1h');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const fetched = vi.mocked(fetch).mock.calls.length;
    let refreshes = 0;
    query.onDidRequestRefresh(() => refreshes++);
    history.pushState(null, '', '#w=3');
    window.dispatchEvent(new PopStateEvent('popstate'));
    history.back();
    await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    await settle();
    expect(location.hash).toBe('');
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetched);
    expect(refreshes).toBe(0);
    expect(rendered).toEqual(['Shop']);
    expect(query.time.range).toBe('1h');
  });

  it('goes to a hash on the page shown when the page asked for before has not loaded yet', async () => {
    await host.start();
    let respond!: () => void;
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (respond = () => resolve(new Response(JSON.stringify(page('Checkout')))))));
    const toCheckout = host.navigate('/p/checkout');
    await host.navigate('/p/shop#w=3');
    respond();
    await toCheckout;
    expect(location.pathname).toBe('/p/shop');
    expect(location.hash).toBe('#w=3');
    expect(rendered).toEqual(['Shop']);
  });

  it('opens a link to another page in the content area', async () => {
    await host.start();
    const link = content.appendChild(document.createElement('a'));
    link.href = '/p/checkout';
    link.click();
    await settle();
    expect(location.pathname).toBe('/p/checkout');
    expect(content.textContent).toBe('Checkout');
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
    expect(query.time.range).toBe('1h');
    history.replaceState(null, '', '/p/shop?time=6h');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(query.time.range).toBe('6h');
    expect(rendered).toEqual(['Shop', 'disposed Shop', 'Shop']);

    history.replaceState(null, '', '/p/checkout');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settle();
    expect(content.textContent).toBe('Checkout');
  });

  it('shows a page it cannot load in the content area', async () => {
    history.replaceState(null, '', '/p/gone');
    await host.start();
    expect(content.querySelector('.d-notice--error')!.textContent).toContain('/p/gone: 404');
    expect(host.current).toBeUndefined();
  });

  it('shows a page of a kind without renderer in the content area', async () => {
    pages['/p/shop/page.json'] = { ...page('Docs'), kind: 'docs' };
    await host.start();
    expect(content.querySelector('.d-notice--error')!.textContent).toBe('no renderer for the page kind docs');
  });
});
