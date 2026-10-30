// @vitest-environment jsdom
// Tests for page.ts: the first page, navigate, links, back and forward, a page that cannot be shown.
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
  vi.stubGlobal('fetch', async (url: string) => {
    const shown = pages[url];
    return shown ? new Response(JSON.stringify(shown)) : new Response('404 page not found', { status: 404 });
  });
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
    expect(content.querySelector('.alert-error')!.textContent).toContain('/p/gone: 404');
    expect(host.current).toBeUndefined();
  });

  it('shows a page of a kind without renderer in the content area', async () => {
    pages['/p/shop/page.json'] = { ...page('Docs'), kind: 'docs' };
    await host.start();
    expect(content.querySelector('.alert-error')!.textContent).toBe('no renderer for the page kind docs');
  });
});
