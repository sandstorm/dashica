// @vitest-environment jsdom
// Tests for filters.ts: the funnel button and the filter bar per page, the buttons, the SQL filter.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import { filters } from './filters';

let query: QueryHost;
let titleBar: HTMLElement;
let bar: HTMLElement;
let page: { current: PageJson | undefined; onDidChangePage: EventEmitter<PageJson>['event'] };
let pageChanged: EventEmitter<PageJson>;

const shop: PageJson = {
  kind: 'dashboard',
  title: 'Shop',
  filterBar: true,
  filterButtons: [
    { title: 'Errors', queryPart: 'status >= 500' },
    { title: 'Path', queryPart: "path LIKE '...%'" },
  ],
  widgets: [],
};

/** Shows `shown` as the page. */
function show(shown: PageJson): void {
  page.current = shown;
  pageChanged.fire(shown);
}

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  query = new QueryHost(window);
  query.load();
  titleBar = document.body.appendChild(document.createElement('div'));
  bar = document.body.appendChild(document.createElement('div'));
  pageChanged = new EventEmitter<PageJson>();
  page = { current: undefined, onDidChangePage: pageChanged.event };
  const ui = {
    registerBarItem: (name: string, el: HTMLElement) => {
      (name === 'title' ? titleBar : bar).appendChild(el);
      return { dispose: () => el.remove() };
    },
  };
  filters.activate({ query, page, ui, subscriptions: [] } as unknown as ExtensionContext);
  show(shop);
});

afterEach(() => {
  query.dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

const button = (title: string) => [...bar.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === title)!;
const funnel = () => titleBar.querySelector<HTMLButtonElement>('button[aria-label=Filters]')!;
const sql = () => bar.querySelector('textarea')!;
const active = () => !funnel().querySelector<HTMLElement>('.d-badge')!.hidden;

describe('filters', () => {
  it('adds a filter button’s condition to the SQL filter', () => {
    expect(active()).toBe(false);
    button('Errors').click();
    expect(query.filters.sql).toBe('status >= 500');
    expect(sql().value).toBe('status >= 500');
    expect(active()).toBe(true);
  });

  it('asks for the value of a `...` in a condition; nothing when the viewer cancels', () => {
    vi.stubGlobal('prompt', () => '/api/');
    button('Path').click();
    expect(query.filters.sql).toBe("path LIKE '/api/%'");
    vi.stubGlobal('prompt', () => null);
    button('Path').click();
    expect(query.filters.sql).toBe("path LIKE '/api/%'");
  });

  it('sets the SQL filter typed, after the funnel button opened it', () => {
    expect(sql().hidden).toBe(true);
    funnel().click();
    expect(sql().hidden).toBe(false);
    sql().value = "method = 'POST'";
    sql().dispatchEvent(new Event('input'));
    expect(query.filters.sql).toBe("method = 'POST'");
  });

  it('opens the SQL filter while there is one (a filter button, a shared link)', () => {
    expect(sql().hidden).toBe(true);
    button('Errors').click();
    expect(sql().hidden).toBe(false);
  });

  it('has no filter bar on a page without filter buttons until the SQL filter is opened', () => {
    show({ ...shop, title: 'Checkout', filterButtons: [] });
    expect(bar.children.length).toBe(0);
    expect(funnel()).toBeDefined();
    funnel().click();
    expect(bar.children.length).toBe(1);
    funnel().click();
    expect(bar.children.length).toBe(0);
  });

  it('is gone on a page without filters', () => {
    show({ ...shop, title: 'Checkout', filterBar: false });
    expect(bar.children.length).toBe(0);
    expect(titleBar.children.length).toBe(0);
  });
});
