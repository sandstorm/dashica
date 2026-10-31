// @vitest-environment jsdom
// Tests for filters.ts: the funnel button and the filter bar per page, the chips (structured and SQL, added, edited,
// removed), the buttons as toggles (buttonOf), a button's value asked for in an input box.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import { buttonOf, filters } from './filters';

let query: QueryHost;
let topBar: HTMLElement;
let bar: HTMLElement;
let page: { current: PageJson | undefined; onDidChangePage: EventEmitter<PageJson | undefined>['event'] };
let pageChanged: EventEmitter<PageJson | undefined>;
/** What `ui.showInputBox` answers next, and the boxes it was asked to show. */
let answer: string | undefined;
let asked: { title?: string; prompt?: string; anchor?: unknown }[];

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

/** Shows `shown` as the page; `undefined`: a tab without one (loading, or it could not be loaded). */
function show(shown: PageJson | undefined): void {
  page.current = shown;
  pageChanged.fire(shown);
}

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  query = new QueryHost(window);
  query.load();
  topBar = document.body.appendChild(document.createElement('div'));
  bar = document.body.appendChild(document.createElement('div'));
  pageChanged = new EventEmitter<PageJson | undefined>();
  page = { current: undefined, onDidChangePage: pageChanged.event };
  const ui = {
    registerBarItem: (name: string, el: HTMLElement) => {
      (name === 'top' ? topBar : bar).appendChild(el);
      return { dispose: () => el.remove() };
    },
    showInputBox: async (options: { title?: string; prompt?: string; anchor?: unknown }) => (asked.push(options), answer),
  };
  asked = [];
  filters.activate({ query, page, ui, subscriptions: [] } as unknown as ExtensionContext);
  show(shop);
});

afterEach(() => {
  query.dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

const button = (title: string) => [...bar.querySelectorAll<HTMLButtonElement>('.d-filter-bar__buttons button')].find((b) => b.textContent === title)!;
const funnel = () => topBar.querySelector<HTMLButtonElement>('button[aria-label=Filters]')!;
const editor = () => bar.querySelector<HTMLTextAreaElement | HTMLInputElement>('[data-testid=filter-chip-editor] textarea, [data-testid=filter-chip-editor] input');
const chips = () => [...bar.querySelectorAll<HTMLElement>('[data-testid=filter-chip]')];
const chipText = (chip: HTMLElement) =>
  ['label', 'op', 'value']
    .map((part) => chip.querySelector(`.d-filter-chip__${part}`)?.textContent ?? '')
    .filter((text) => text !== '')
    .join(' ');
const key = (field: Element, k: string, init: KeyboardEventInit = {}) => field.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
const type = (text: string) => {
  editor()!.value = text;
};

describe('buttonOf', () => {
  const buttons = shop.filterButtons;

  it('finds the button whose condition a SQL chip is, the text in place of each `...`', () => {
    expect(buttonOf('status >= 500', buttons)).toEqual({ button: buttons[0], values: [] });
    expect(buttonOf("path LIKE '/api%'", buttons)).toEqual({ button: buttons[1], values: ['/api'] });
  });

  it('finds none for other SQL, or an empty text in place of `...`', () => {
    expect(buttonOf('status >= 400', buttons)).toBeUndefined();
    expect(buttonOf("path LIKE '%'", buttons)).toBeUndefined();
    expect(buttonOf('status >= 500', [])).toBeUndefined();
  });
});

describe('filters', () => {
  it('adds a filter button’s condition as a SQL chip labelled by the button, and shows the button pressed', () => {
    expect(button('Errors').getAttribute('aria-pressed')).toBe('false');
    button('Errors').click();
    expect(query.filters.chips).toEqual([{ kind: 'sql', sql: 'status >= 500' }]);
    expect(chips().map(chipText)).toEqual(['Errors']);
    expect(chips()[0].title).toBe('status >= 500');
    expect(button('Errors').getAttribute('aria-pressed')).toBe('true');
  });

  it('removes the chip of a pressed button when it is pressed again', () => {
    query.load({ search: '?sql=status+%3E%3D+500&f=host:eq:a' });
    expect(button('Errors').getAttribute('aria-pressed')).toBe('true');
    button('Errors').click();
    expect(query.filters.chips).toEqual([{ kind: 'field', fieldId: 'host', op: 'eq', value: 'a' }]);
    expect(button('Errors').getAttribute('aria-pressed')).toBe('false');
  });

  it('removes every chip of a released `...` button in one change: one history entry', () => {
    query.load({ search: "?sql=path+LIKE+%27%2Fa%25%27&f=host:eq:a&sql=path+LIKE+%27%2Fb%25%27" });
    let changes = 0;
    query.filters.onDidChange(() => changes++);
    button('Path').click();
    expect(query.filters.chips).toEqual([{ kind: 'field', fieldId: 'host', op: 'eq', value: 'a' }]);
    expect(changes).toBe(1);
  });

  it('asks for the value of a `...` in a condition in an input box below the button; nothing when the viewer cancels', async () => {
    answer = '/api/';
    const pressed = button('Path');
    pressed.click();
    await vi.waitFor(() => expect(query.filters.chips).toEqual([{ kind: 'sql', sql: "path LIKE '/api/%'" }]));
    expect(asked).toEqual([{ title: 'Parameter value', prompt: "Path: path LIKE '...%'", anchor: pressed }]);
    expect(chips().map(chipText)).toEqual(['Path: /api/']);
    query.filters.clear();
    answer = undefined;
    button('Path').click();
    await Promise.resolve();
    expect([query.filters.chips, asked.length]).toEqual([[], 2]);
  });

  it('shows a SQL chip that matches no button as `SQL:` and its text on one line', () => {
    query.load({ search: '?sql=a+%0AAND+b' });
    expect(chips().map(chipText)).toEqual(['SQL: a AND b']);
    expect(chips()[0].title).toBe('a \nAND b');
  });

  it('adds a SQL chip from the funnel on Enter; Escape or an empty text adds none', () => {
    expect(editor()).toBeNull();
    funnel().click();
    expect(document.activeElement).toBe(editor());
    type("method = 'POST'");
    key(editor()!, 'Enter');
    expect(query.filters.chips).toEqual([{ kind: 'sql', sql: "method = 'POST'" }]);
    expect(editor()).toBeNull();
    funnel().click();
    type('status >= 500');
    key(editor()!, 'Escape');
    funnel().click();
    key(editor()!, 'Enter');
    expect(query.filters.chips).toHaveLength(1);
    expect(editor()).toBeNull();
  });

  it('keeps a new line typed with Shift+Enter in the SQL chip being added', () => {
    funnel().click();
    type('a');
    expect(key(editor()!, 'Enter', { shiftKey: true, cancelable: true })).toBe(true);
    expect(query.filters.chips).toEqual([]);
  });

  it('edits a SQL chip in place: Enter or leaving the field applies, Escape cancels, an empty text removes it', () => {
    query.load({ search: '?f=host:eq:a&sql=status+%3E%3D+400' });
    chips()[1].querySelector<HTMLElement>('.d-filter-chip__value')!.click();
    expect(editor()!.value).toBe('status >= 400');
    type('status >= 500');
    key(editor()!, 'Escape');
    expect(query.filters.chips[1]).toEqual({ kind: 'sql', sql: 'status >= 400' });
    chips()[1].querySelector<HTMLElement>('.d-filter-chip__value')!.click();
    type('status >= 300');
    editor()!.dispatchEvent(new Event('blur'));
    expect(query.filters.chips[1]).toEqual({ kind: 'sql', sql: 'status >= 300' });
    chips()[1].querySelector<HTMLElement>('.d-filter-chip__value')!.click();
    type('');
    key(editor()!, 'Enter');
    expect(query.filters.chips).toEqual([{ kind: 'field', fieldId: 'host', op: 'eq', value: 'a' }]);
  });

  it('edits a structured chip’s value; its = / ≠ flips the op', () => {
    query.filters.add('host', 'eq', 'a');
    chips()[0].querySelector<HTMLElement>('.d-filter-chip__value')!.click();
    expect(editor()!.value).toBe('a');
    type('b');
    key(editor()!, 'Enter');
    expect(query.filters.chips).toEqual([{ kind: 'field', fieldId: 'host', op: 'eq', value: 'b' }]);
    chips()[0].querySelector<HTMLButtonElement>('.d-filter-chip__op')!.click();
    expect(chips().map(chipText)).toEqual(['host ≠ b']);
  });

  it('edits a filter button’s chip into other SQL, the button released', () => {
    button('Errors').click();
    chips()[0].querySelector<HTMLElement>('.d-filter-chip__label')!.click();
    expect(editor()!.value).toBe('status >= 500');
    type('status >= 400');
    key(editor()!, 'Enter');
    expect(chips().map(chipText)).toEqual(['SQL: status >= 400']);
    expect(button('Errors').getAttribute('aria-pressed')).toBe('false');
  });

  it('has no filter bar on a page without filter buttons until the funnel adds a SQL chip', () => {
    show({ ...shop, title: 'Checkout', filterButtons: [] });
    expect(bar.children.length).toBe(0);
    funnel().click();
    expect(bar.children.length).toBe(1);
    key(editor()!, 'Escape');
    expect(bar.children.length).toBe(0);
  });

  it('shows a chip per structured filter, labelled by its id', () => {
    query.filters.add('host', 'eq', 'a');
    query.filters.add('path', 'ne', '/api');
    expect(chips().map(chipText)).toEqual(['host = a', 'path ≠ /api']);
  });

  it('shows the chips of a link’s filters in their order', () => {
    query.load({ search: '?sql=duration+%3E+2000&f=host:ne:a&sql=b' });
    show(shop);
    expect(chips().map(chipText)).toEqual(['SQL: duration > 2000', 'host ≠ a', 'SQL: b']);
  });

  it('removes a chip with its ×', () => {
    query.filters.add('host', 'eq', 'a');
    query.filters.add('status >= 400');
    query.filters.add('host', 'eq', 'b');
    chips()[0].querySelector<HTMLButtonElement>('button[aria-label="Remove host = a"]')!.click();
    chips()[0].querySelector<HTMLButtonElement>('button[aria-label="Remove status >= 400"]')!.click();
    expect(query.filters.chips).toEqual([{ kind: 'field', fieldId: 'host', op: 'eq', value: 'b' }]);
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
    expect(topBar.children.length).toBe(0);
  });

  it('is gone in a tab without a page', () => {
    show(undefined);
    expect(bar.children.length).toBe(0);
    expect(topBar.children.length).toBe(0);
  });
});
