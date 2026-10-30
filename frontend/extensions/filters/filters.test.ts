// @vitest-environment jsdom
// Tests for filters.ts: the funnel button and the filter bar per page, the chips, the buttons, the SQL filter, the
// floating bar's entries for a selection.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson } from '../../generated/zz_generated.dashica';
import { CommandsHost, type MenuItem } from '../../hosts/commands/commands';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import type { Selection } from '../../hosts/widgets/widgets';
import { filters } from './filters';

let query: QueryHost;
let titleBar: HTMLElement;
let bar: HTMLElement;
let page: { current: PageJson | undefined; onDidChangePage: EventEmitter<PageJson>['event'] };
let pageChanged: EventEmitter<PageJson>;
let menuItems: { menuId: string; item: MenuItem<Selection> }[];
let commands: CommandsHost;
let selectionCleared: number;

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
    registerMenuItem: (menuId: string, item: MenuItem<Selection>) => {
      menuItems.push({ menuId, item });
      return { dispose() {} };
    },
  };
  menuItems = [];
  commands = new CommandsHost(document.body);
  selectionCleared = 0;
  const widgets = { clearSelection: () => selectionCleared++ };
  filters.activate({ query, page, ui, commands, widgets, subscriptions: [] } as unknown as ExtensionContext);
  show(shop);
});

afterEach(() => {
  query.dispose();
  commands.dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

const button = (title: string) => [...bar.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === title)!;
const funnel = () => titleBar.querySelector<HTMLButtonElement>('button[aria-label=Filters]')!;
const sql = () => bar.querySelector('textarea')!;
const chips = () => [...bar.querySelectorAll<HTMLElement>('.d-filter-chip')];
const chipText = (chip: HTMLElement) =>
  ['label', 'op', 'value'].map((part) => chip.querySelector(`.d-filter-chip__${part}`)!.textContent).join(' ');
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

  it('shows a chip per structured filter, labelled by its id', () => {
    query.filters.add('host', 'eq', 'a');
    query.filters.add('path', 'ne', '/api');
    expect(chips().map(chipText)).toEqual(['host = a', 'path ≠ /api']);
  });

  it('shows the chips of a link’s filters', () => {
    history.replaceState(null, '', '/p/shop?f=host:ne:a');
    query.load();
    show(shop);
    expect(chips().map(chipText)).toEqual(['host ≠ a']);
  });

  it('removes a structured filter with its chip’s ×', () => {
    query.filters.add('host', 'eq', 'a');
    query.filters.add('host', 'eq', 'b');
    chips()[0].querySelector<HTMLButtonElement>('button[aria-label="Remove host = a"]')!.click();
    expect(query.filters.fields).toEqual([{ fieldId: 'host', op: 'eq', value: 'b' }]);
    expect(chips().map(chipText)).toEqual(['host = b']);
  });

  it('shows the filter bar while there are chips, on a page without filter buttons', () => {
    show({ ...shop, title: 'Checkout', filterButtons: [] });
    expect(bar.children.length).toBe(0);
    query.filters.add('host', 'eq', 'a');
    expect(bar.children.length).toBe(1);
    query.filters.clear();
    expect(bar.children.length).toBe(0);
  });

  it('is gone on a page without filters', () => {
    show({ ...shop, title: 'Checkout', filterBar: false });
    expect(bar.children.length).toBe(0);
    expect(titleBar.children.length).toBe(0);
  });
});

describe('the floating bar widget/selection', () => {
  const selected: Selection = { kind: 'category', widgetId: '3', fieldId: 'host', value: 'a', anchor: document.createElement('div') };
  const entries = (selection: Selection) => menuItems.filter(({ menuId, item }) => menuId === 'widget/selection' && (item.when?.(selection) ?? true)).map(({ item }) => item);

  it('offers "Filter by" and "Exclude" for a category', () => {
    expect(entries(selected).map((item) => item.title)).toEqual(['Filter by', 'Exclude']);
    expect(entries({ ...selected, kind: 'time' } as unknown as Selection)).toEqual([]);
  });

  it('adds the category as a structured filter, = or ≠, and ends the selection', async () => {
    const [filterBy, exclude] = entries(selected);
    await commands.executeCommand(filterBy.command, selected);
    await commands.executeCommand(exclude.command, { ...selected, value: 'b' });
    expect(query.filters.fields).toEqual([
      { fieldId: 'host', op: 'eq', value: 'a' },
      { fieldId: 'host', op: 'ne', value: 'b' },
    ]);
    expect(selectionCleared).toBe(2);
    expect(bar.querySelectorAll('[data-testid=filter-chip]')).toHaveLength(2);
  });
});
