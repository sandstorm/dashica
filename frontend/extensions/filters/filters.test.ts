// @vitest-environment jsdom
// Tests for filters.ts: the funnel button and the filter bar per page, the chips (pills and SQL, added, SQL ones
// edited, removed), the buttons as toggles in place (buttonOf), their signed pills without a chip of their own, a
// button's value asked for in an input box, made a pill by its page and shown beside it, a new value in its chip's
// place, "Add filter" while a chart filters a table; with SQL filters off (filters.sqlEnabled), no funnel and a SQL
// chip only removed, the buttons as before.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, WorkbenchJson } from '../../generated/zz_generated.dashica';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost, type FilterChip } from '../../hosts/query/query';
import { buttonOf, filters } from './filters';

let query: QueryHost;
let topBar: HTMLElement;
let bar: HTMLElement;
let page: { current: PageJson | undefined; onDidChangePage: EventEmitter<PageJson | undefined>['event']; workbench: WorkbenchJson };
let ui: object;
let pageChanged: EventEmitter<PageJson | undefined>;
/** What `ui.showInputBox` answers next, and the boxes it was asked to show. */
let answer: string | undefined;
let asked: { title?: string; prompt?: string; anchor?: unknown }[];
/** The quick picks shown (all cancelled): their labels and anchor. */
let picks: { labels: string[]; anchor: unknown }[];

/**
 * A pill's key as the server signs it (`<payload>.<mac>`, the payload base64url JSON) with `label` and `payload`; its
 * mac is none.
 */
function keyOf(label: string, payload: object = {}): string {
  const json = new TextEncoder().encode(JSON.stringify({ condition: 'x', label, ...payload }));
  return `${btoa(String.fromCharCode(...json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.mac`;
}

const PATH = "path ILIKE concat(..., '%')";
/** The pill of the button Path for `value`, as `/p/shop/button` answers it, and its chip. */
const pathPill = (value: string) => ({ key: keyOf(`Path: ${value}`, { button: PATH, value }), label: `Path: ${value}` });
const pathChip = (value: string) => ({ kind: 'pill', ...pathPill(value) });

const errorsKey = keyOf('Errors', { button: 'status >= 500' });
const shop: PageJson = {
  kind: 'dashboard',
  title: 'Shop',
  filterBar: true,
  filterButtons: [
    { title: 'Errors', queryPart: 'status >= 500', key: errorsKey },
    { title: 'Path', queryPart: PATH, url: '/p/shop/button?i=1' },
  ],
  widgets: [],
};

/** The URLs `fetch` was asked; each answered with the pill of the button Path for its `value`. */
let fetched: string[];

/** The pill labelled `label`, as `/pill` answers it, and the chip it is. */
const pill = (label: string) => ({ key: keyOf(label), label });
const chipOf = (label: string) => ({ kind: 'pill', ...pill(label) });

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
  page = { current: undefined, onDidChangePage: pageChanged.event, workbench: { menu: [], explore: false, sqlEnabled: true, connections: [] } };
  ui = {
    registerBarItem: (name: string, el: HTMLElement) => {
      (name === 'top' ? topBar : bar).appendChild(el);
      return { dispose: () => el.remove() };
    },
    showInputBox: async (options: { title?: string; prompt?: string; anchor?: unknown }) => (asked.push(options), answer),
    showQuickPick: async (items: { label: string }[], options: { anchor?: unknown }) => (picks.push({ labels: items.map((i) => i.label), anchor: options.anchor }), undefined),
  };
  asked = [];
  picks = [];
  fetched = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return new Response(JSON.stringify(pathPill(new URL(url, 'http://x').searchParams.get('value')!)));
  });
});

/** Activates the extension, the server taking SQL chips or not (filters.sqlEnabled), and shows the page Shop. */
function activate(sqlEnabled: boolean): void {
  page.workbench.sqlEnabled = sqlEnabled;
  filters.activate({ query, page, ui, subscriptions: [] } as unknown as ExtensionContext);
  show(shop);
}

afterEach(() => {
  query.dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

/** The filter button `title`. */
const button = (title: string) => [...bar.querySelectorAll<HTMLButtonElement>('.d-filter-bar__buttons button')].find((b) => b.textContent === title)!;
/** The values shown beside the pressed `...` button `title`. */
const values = (title: string) => [...bar.querySelectorAll<HTMLButtonElement>(`[aria-label="${title}"] .d-filter-button__value`)];
const funnel = () => topBar.querySelector<HTMLButtonElement>('button[aria-label=Filters]')!;
const editor = () => bar.querySelector<HTMLTextAreaElement | HTMLInputElement>('[data-testid=filter-chip-editor] textarea, [data-testid=filter-chip-editor] input');
const chips = () => [...bar.querySelectorAll<HTMLElement>('[data-testid=filter-chip]')];
const chipText = (chip: HTMLElement) =>
  ['label', 'value']
    .map((part) => chip.querySelector(`.d-filter-chip__${part}`)?.textContent ?? '')
    .filter((text) => text !== '')
    .join(' ');
const key = (field: Element, k: string, init: KeyboardEventInit = {}) => field.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
const type = (text: string) => {
  editor()!.value = text;
};

describe('buttonOf', () => {
  const buttons = shop.filterButtons;

  it('finds the button a pill was made for, by its condition, and the value written in', () => {
    expect(buttonOf({ kind: 'pill', key: errorsKey, label: 'Errors' }, buttons)).toEqual({ button: buttons[0], value: '' });
    expect(buttonOf(pathChip("O'Brien") as FilterChip, buttons)).toEqual({ button: buttons[1], value: "O'Brien" });
  });

  it('finds none for a SQL chip, the pill of a field, or a button the page lacks', () => {
    expect(buttonOf({ kind: 'sql', sql: 'status >= 500' }, buttons)).toBeUndefined();
    expect(buttonOf(chipOf('host = a') as FilterChip, buttons)).toBeUndefined();
    expect(buttonOf({ kind: 'pill', key: errorsKey, label: 'Errors' }, [])).toBeUndefined();
  });
});

describe('filters', () => {
  beforeEach(() => activate(true));

  it('adds a filter button’s signed pill and shows the button pressed, with no chip for it', () => {
    expect(button('Errors').getAttribute('aria-pressed')).toBe('false');
    button('Errors').click();
    expect(query.filters.chips).toEqual([{ kind: 'pill', key: errorsKey, label: 'Errors' }]);
    expect(chips()).toEqual([]);
    expect(button('Errors').getAttribute('aria-pressed')).toBe('true');
    expect(button('Errors').title).toBe('status >= 500');
  });

  it('keeps the chips of other filters in their order, a button’s pill among them', () => {
    query.load({ search: `?sql=a&f=${errorsKey}&f=${keyOf('host = a')}` });
    expect(chips().map(chipText)).toEqual(['SQL: a', 'host = a']);
    chips()[1].querySelector<HTMLButtonElement>('button[aria-label="Remove host = a"]')!.click();
    expect(query.filters.chips).toEqual([
      { kind: 'sql', sql: 'a' },
      { kind: 'pill', key: errorsKey, label: 'Errors' },
    ]);
  });

  it('shows a button’s pill as a chip on a page without that button', () => {
    query.load({ search: `?f=${errorsKey}` });
    show({ ...shop, title: 'Checkout', filterButtons: [] });
    expect(chips().map(chipText)).toEqual(['Errors']);
  });

  it('does not take a SQL chip of the same condition for the button', () => {
    query.load({ search: '?sql=status+%3E%3D+500' });
    expect([chips().map(chipText), button('Errors').getAttribute('aria-pressed')]).toEqual([['SQL: status >= 500'], 'false']);
  });

  it('removes the chip of a pressed button when it is pressed again', () => {
    query.load({ search: `?f=${errorsKey}&f=${keyOf('host = a')}` });
    expect(button('Errors').getAttribute('aria-pressed')).toBe('true');
    button('Errors').click();
    expect(query.filters.chips).toEqual([chipOf('host = a')]);
    expect(button('Errors').getAttribute('aria-pressed')).toBe('false');
  });

  it('removes every chip of a released `...` button in one change: one history entry', () => {
    query.load({ search: `?f=${pathPill('/a').key}&f=${keyOf('host = a')}&f=${pathPill('/b').key}` });
    let changes = 0;
    query.filters.onDidChange(() => changes++);
    expect(values('Path').map((b) => b.textContent)).toEqual(['/a', '/b']);
    button('Path').click();
    expect(query.filters.chips).toEqual([chipOf('host = a')]);
    expect(changes).toBe(1);
  });

  it('asks for the value of a `...` in an input box below the button, its pill made by the page, the value shown beside it; nothing when the viewer cancels', async () => {
    answer = "O'Brien";
    const pressed = button('Path');
    pressed.click();
    await vi.waitFor(() => expect(query.filters.chips).toEqual([pathChip("O'Brien")]));
    expect(fetched).toEqual([`/p/shop/button?i=1&value=O%27Brien`]);
    expect(asked).toEqual([{ title: 'Parameter value', prompt: `Path: ${PATH}`, value: undefined, anchor: pressed }]);
    expect([button('Path').getAttribute('aria-pressed'), values('Path').map((b) => b.textContent), chips()]).toEqual(['true', ["O'Brien"], []]);
    query.filters.clear();
    answer = undefined;
    button('Path').click();
    await Promise.resolve();
    expect([query.filters.chips, asked.length, fetched.length]).toEqual([[], 2, 1]);
  });

  it('asks a new value for a pressed `...` button on a click on its value, the old one shown, and puts its pill in the chip’s place', async () => {
    query.load({ search: `?f=${keyOf('host = a')}&f=${pathPill('/a').key}&f=${keyOf('host = b')}` });
    answer = '/b';
    const value = values('Path')[0];
    value.click();
    await vi.waitFor(() => expect(query.filters.chips).toEqual([chipOf('host = a'), pathChip('/b'), chipOf('host = b')]));
    expect(asked).toEqual([{ title: 'Parameter value', prompt: `Path: ${PATH}`, value: '/a', anchor: value }]);
  });

  it('adds nothing when the page refuses the value', async () => {
    vi.stubGlobal('fetch', async () => new Response('filter button "Path" needs a value', { status: 400 }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer = 'x';
    button('Path').click();
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    expect(query.filters.chips).toEqual([]);
    logged.mockRestore();
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
    query.load({ search: `?f=${keyOf('host = a')}&sql=status+%3E%3D+400` });
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
    expect(query.filters.chips).toEqual([chipOf('host = a')]);
  });

  it('does not edit a pill: its condition is the server’s', () => {
    query.filters.add(pill('host = a'));
    chips()[0].querySelector<HTMLElement>('.d-filter-chip__value')!.click();
    expect(editor()).toBeNull();
    expect(chips()[0].querySelector('.d-filter-chip__op, .d-filter-chip__label')).toBeNull();
    expect(chips()[0].classList).toContain('d-filter-chip--pill');
  });

  it('has no filter bar on a page without filter buttons until the funnel adds a SQL chip', () => {
    show({ ...shop, title: 'Checkout', filterButtons: [] });
    expect(bar.children.length).toBe(0);
    funnel().click();
    expect(bar.children.length).toBe(1);
    key(editor()!, 'Escape');
    expect(bar.children.length).toBe(0);
  });

  it('shows a chip per pill, its label', () => {
    query.filters.add(pill('host = a'));
    query.filters.add(pill('path ≠ /api'));
    expect(chips().map(chipText)).toEqual(['host = a', 'path ≠ /api']);
  });

  it('shows the chips of a link’s filters in their order', () => {
    query.load({ search: `?sql=duration+%3E+2000&f=${keyOf('host ≠ a')}&sql=b` });
    show(shop);
    expect(chips().map(chipText)).toEqual(['SQL: duration > 2000', 'host ≠ a', 'SQL: b']);
  });

  it('removes a chip with its ×', () => {
    query.filters.add(pill('host = a'));
    query.filters.add('status >= 400');
    query.filters.add(pill('host = b'));
    chips()[0].querySelector<HTMLButtonElement>('button[aria-label="Remove host = a"]')!.click();
    chips()[0].querySelector<HTMLButtonElement>('button[aria-label="Remove status >= 400"]')!.click();
    expect(query.filters.chips).toEqual([chipOf('host = b')]);
    expect(chips().map(chipText)).toEqual(['host = b']);
  });

  it('shows the filter bar while there are chips, on a page without filter buttons', () => {
    show({ ...shop, title: 'Checkout', filterButtons: [] });
    expect(bar.children.length).toBe(0);
    query.filters.add(pill('host = a'));
    expect(bar.children.length).toBe(1);
    query.filters.clear();
    expect(bar.children.length).toBe(0);
  });

  it('shows "Add filter" after the chips while a chart filters a table, which asks for a field of it below the button', async () => {
    const byHost = { type: 'barVertical', props: {}, dataUrl: '/p/shop/api/1', filterable: ['host'], table: 'default.http_logs', connection: 'default' };
    const add = () => [...bar.querySelectorAll<HTMLButtonElement>('.d-filter-bar__chips button')].find((b) => b.textContent === 'Add filter');
    expect(add()).toBeUndefined();

    show({ ...shop, title: 'Checkout', filterButtons: [], widgets: [byHost] as PageJson['widgets'] });
    query.filters.add('a');

    expect(bar.children.length).toBe(1);
    expect(bar.querySelector('.d-filter-bar__chips')!.lastElementChild).toBe(add());
    add()!.click();
    await vi.waitFor(() => expect(picks).toEqual([{ labels: ['host'], anchor: add() }]));
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

describe('filters with SQL filters off', () => {
  beforeEach(() => activate(false));

  it('still presses a filter button: its pill is signed', () => {
    button('Errors').click();
    expect([query.filters.chips, button('Errors').getAttribute('aria-pressed')]).toEqual([[{ kind: 'pill', key: errorsKey, label: 'Errors' }], 'true']);
  });

  it('has no funnel: the bar offers no way to type SQL', () => {
    expect(funnel()).toBeNull();
    expect(topBar.children.length).toBe(0);
  });

  it('shows a link’s SQL chip, not edited, saying why; its × removes it', () => {
    query.load({ search: '?sql=status+%3E%3D+400' });
    chips()[0].querySelector<HTMLElement>('.d-filter-chip__value')!.click();
    expect(editor()).toBeNull();
    expect(chips()[0].title).toBe('status >= 400\nSQL filters are not enabled (filters.sqlEnabled)');
    chips()[0].querySelector<HTMLButtonElement>('button[aria-label="Remove status >= 400"]')!.click();
    expect(query.filters.chips).toEqual([]);
  });

  it('still shows the pills and "Add filter"', () => {
    const byHost = { type: 'barVertical', props: {}, dataUrl: '/p/shop/api/1', filterable: ['host'], table: 'default.http_logs', connection: 'default' };
    show({ ...shop, filterButtons: [], widgets: [byHost] as PageJson['widgets'] });
    query.filters.add(pill('host = a'));
    expect(chips().map(chipText)).toEqual(['host = a']);
    expect([...bar.querySelectorAll('.d-filter-bar__chips button')].some((b) => b.textContent === 'Add filter')).toBe(true);
  });
});
