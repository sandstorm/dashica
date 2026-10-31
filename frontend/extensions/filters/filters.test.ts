// @vitest-environment jsdom
// Tests for filters.ts: the funnel button and the filter bar per page, the chips (pills and SQL, added, SQL ones
// edited, removed), the buttons as toggles in place (buttonOf), their signed pills without a chip of their own, a
// button's value asked for in an input box, made a pill by its page and shown beside it, a new value in its chip's
// place, "Add filter" while a chart filters a table; a field's pill edited in place, its operator picked among the ops
// of its type and its value asked anew (a time's in an input box), each made again by a chart of the page, one no
// chart makes only removed; with SQL filters off
// (filters.sqlEnabled), no funnel and a SQL chip only removed, the buttons and the pills as before; a chart click's
// `filters.offer` adding the pill chosen to the tab shown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, WorkbenchJson } from '../../generated/zz_generated.dashica';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import { FILTERS, addChip, replaceChip, type FilterChip } from './chips';
import { buttonOf, filters } from './filters';

let query: QueryHost;
let topBar: HTMLElement;
let bar: HTMLElement;
let page: { current: PageJson | undefined; onDidChangePage: EventEmitter<PageJson | undefined>['event']; workbench: WorkbenchJson };
let ui: object;
let pageChanged: EventEmitter<PageJson | undefined>;
/** What `ui.showInputBox` answers next, and the boxes it was asked to show. */
let answer: string | undefined;
let asked: { title?: string; prompt?: string; value?: string; anchor?: unknown }[];
/** The quick picks shown (all cancelled, unless `picked` names the label to choose): their labels and anchor. */
let picks: { labels: string[]; anchor: unknown }[];
let picked: string | undefined;
/** The commands the extension registered, by id. */
let commands: Map<string, (...args: any[]) => unknown>;

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
const pathChip = (value: string) => ({ kind: 'pill', key: pathPill(value).key });

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
const chipOf = (label: string) => ({ kind: 'pill', key: pill(label).key });

/** The tab's filter chips (`FILTERS`). */
const held = () => query.get(FILTERS);
const addPill = ({ key }: { key: string }) => query.set(FILTERS, addChip(held(), { kind: 'pill', key }));
const addSql = (sql: string) => query.set(FILTERS, addChip(held(), { kind: 'sql', sql }));

/** Shows `shown` as the page; `undefined`: a tab without one (loading, or it could not be loaded). */
function show(shown: PageJson | undefined): void {
  page.current = shown;
  pageChanged.fire(shown);
}

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  query = new QueryHost();
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
    showInputBox: async (options: { title?: string; prompt?: string; value?: string; anchor?: unknown }) => (asked.push(options), answer),
    showQuickPick: async (items: { label: string }[], options: { anchor?: unknown }) => (
      picks.push({ labels: items.map((i) => i.label), anchor: options.anchor }), items.find((i) => i.label === picked)
    ),
  };
  asked = [];
  picks = [];
  picked = undefined;
  commands = new Map();
  fetched = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return new Response(JSON.stringify(pathPill(new URL(url, 'http://x').searchParams.get('value')!)));
  });
});

/** Activates the extension, the server taking SQL chips or not (filters.sqlEnabled), and shows the page Shop. */
function activate(sqlEnabled: boolean): void {
  page.workbench.sqlEnabled = sqlEnabled;
  const registry = { registerCommand: (id: string, handler: (...args: any[]) => unknown) => (commands.set(id, handler), { dispose: () => commands.delete(id) }) };
  filters.activate({ query, page, ui, commands: registry, subscriptions: [] } as unknown as ExtensionContext);
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
  ['label', 'field', 'op', 'value']
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
    expect(buttonOf({ kind: 'pill', key: errorsKey }, buttons)).toEqual({ button: buttons[0], value: '' });
    expect(buttonOf(pathChip("O'Brien") as FilterChip, buttons)).toEqual({ button: buttons[1], value: "O'Brien" });
  });

  it('finds none for a SQL chip, the pill of a field, or a button the page lacks', () => {
    expect(buttonOf({ kind: 'sql', sql: 'status >= 500' }, buttons)).toBeUndefined();
    expect(buttonOf(chipOf('host = a') as FilterChip, buttons)).toBeUndefined();
    expect(buttonOf({ kind: 'pill', key: errorsKey }, [])).toBeUndefined();
  });
});

describe('filters', () => {
  beforeEach(() => activate(true));

  it('adds a filter button’s signed pill and shows the button pressed, with no chip for it', () => {
    expect(button('Errors').getAttribute('aria-pressed')).toBe('false');
    button('Errors').click();
    expect(held()).toEqual([{ kind: 'pill', key: errorsKey }]);
    expect(chips()).toEqual([]);
    expect(button('Errors').getAttribute('aria-pressed')).toBe('true');
    expect(button('Errors').title).toBe('status >= 500');
  });

  it('keeps the chips of other filters in their order, a button’s pill among them', () => {
    query.load({ search: `?sql=a&f=${errorsKey}&f=${keyOf('host = a')}` });
    expect(chips().map(chipText)).toEqual(['SQL: a', 'host = a']);
    chips()[1].querySelector<HTMLButtonElement>('button[aria-label="Remove host = a"]')!.click();
    expect(held()).toEqual([
      { kind: 'sql', sql: 'a' },
      { kind: 'pill', key: errorsKey },
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
    expect(held()).toEqual([chipOf('host = a')]);
    expect(button('Errors').getAttribute('aria-pressed')).toBe('false');
  });

  it('removes every chip of a released `...` button in one change: one history entry', () => {
    query.load({ search: `?f=${pathPill('/a').key}&f=${keyOf('host = a')}&f=${pathPill('/b').key}` });
    let changes = 0;
    query.onDidChange(FILTERS, () => changes++);
    expect(values('Path').map((b) => b.textContent)).toEqual(['/a', '/b']);
    button('Path').click();
    expect(held()).toEqual([chipOf('host = a')]);
    expect(changes).toBe(1);
  });

  it('asks for the value of a `...` in an input box below the button, its pill made by the page, the value shown beside it; nothing when the viewer cancels', async () => {
    answer = "O'Brien";
    const pressed = button('Path');
    pressed.click();
    await vi.waitFor(() => expect(held()).toEqual([pathChip("O'Brien")]));
    expect(fetched).toEqual([`/p/shop/button?i=1&value=O%27Brien`]);
    expect(asked).toEqual([{ title: 'Parameter value', prompt: `Path: ${PATH}`, value: undefined, anchor: pressed }]);
    expect([button('Path').getAttribute('aria-pressed'), values('Path').map((b) => b.textContent), chips()]).toEqual(['true', ["O'Brien"], []]);
    query.set(FILTERS, []);
    answer = undefined;
    button('Path').click();
    await Promise.resolve();
    expect([held(), asked.length, fetched.length]).toEqual([[], 2, 1]);
  });

  it('asks a new value for a pressed `...` button on a click on its value, the old one shown, and puts its pill in the chip’s place', async () => {
    query.load({ search: `?f=${keyOf('host = a')}&f=${pathPill('/a').key}&f=${keyOf('host = b')}` });
    answer = '/b';
    const value = values('Path')[0];
    value.click();
    await vi.waitFor(() => expect(held()).toEqual([chipOf('host = a'), pathChip('/b'), chipOf('host = b')]));
    expect(asked).toEqual([{ title: 'Parameter value', prompt: `Path: ${PATH}`, value: '/a', anchor: value }]);
  });

  it('adds nothing when the page refuses the value', async () => {
    vi.stubGlobal('fetch', async () => new Response('filter button "Path" needs a value', { status: 400 }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer = 'x';
    button('Path').click();
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    expect(held()).toEqual([]);
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
    expect(held()).toEqual([{ kind: 'sql', sql: "method = 'POST'" }]);
    expect(editor()).toBeNull();
    funnel().click();
    type('status >= 500');
    key(editor()!, 'Escape');
    funnel().click();
    key(editor()!, 'Enter');
    expect(held()).toHaveLength(1);
    expect(editor()).toBeNull();
  });

  it('keeps a new line typed with Shift+Enter in the SQL chip being added', () => {
    funnel().click();
    type('a');
    expect(key(editor()!, 'Enter', { shiftKey: true, cancelable: true })).toBe(true);
    expect(held()).toEqual([]);
  });

  it('edits a SQL chip in place: Enter or leaving the field applies, Escape cancels, an empty text removes it', () => {
    query.load({ search: `?f=${keyOf('host = a')}&sql=status+%3E%3D+400` });
    chips()[1].querySelector<HTMLElement>('.d-filter-chip__value')!.click();
    expect(editor()!.value).toBe('status >= 400');
    type('status >= 500');
    key(editor()!, 'Escape');
    expect(held()[1]).toEqual({ kind: 'sql', sql: 'status >= 400' });
    chips()[1].querySelector<HTMLElement>('.d-filter-chip__value')!.click();
    type('status >= 300');
    editor()!.dispatchEvent(new Event('blur'));
    expect(held()[1]).toEqual({ kind: 'sql', sql: 'status >= 300' });
    chips()[1].querySelector<HTMLElement>('.d-filter-chip__value')!.click();
    type('');
    key(editor()!, 'Enter');
    expect(held()).toEqual([chipOf('host = a')]);
  });

  it('does not edit a pill without a field: its condition is the server’s', () => {
    addPill(pill('host = a'));
    chips()[0].querySelector<HTMLElement>('.d-filter-chip__value')!.click();
    expect(editor()).toBeNull();
    expect(chips()[0].querySelector('.d-filter-chip__op, .d-filter-chip__label, button.d-filter-chip__value')).toBeNull();
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
    addPill(pill('host = a'));
    addPill(pill('path ≠ /api'));
    expect(chips().map(chipText)).toEqual(['host = a', 'path ≠ /api']);
  });

  it('shows the chips of a link’s filters in their order', () => {
    query.load({ search: `?sql=duration+%3E+2000&f=${keyOf('host ≠ a')}&sql=b` });
    show(shop);
    expect(chips().map(chipText)).toEqual(['SQL: duration > 2000', 'host ≠ a', 'SQL: b']);
  });

  it('removes a chip with its ×', () => {
    addPill(pill('host = a'));
    addSql('status >= 400');
    addPill(pill('host = b'));
    chips()[0].querySelector<HTMLButtonElement>('button[aria-label="Remove host = a"]')!.click();
    chips()[0].querySelector<HTMLButtonElement>('button[aria-label="Remove status >= 400"]')!.click();
    expect(held()).toEqual([chipOf('host = b')]);
    expect(chips().map(chipText)).toEqual(['host = b']);
  });

  it('shows the filter bar while there are chips, on a page without filter buttons', () => {
    show({ ...shop, title: 'Checkout', filterButtons: [] });
    expect(bar.children.length).toBe(0);
    addPill(pill('host = a'));
    expect(bar.children.length).toBe(1);
    query.set(FILTERS, []);
    expect(bar.children.length).toBe(0);
  });

  it('shows "Add filter" after the chips while a chart filters a table, which asks for a field of it below the button', async () => {
    const byHost = { type: 'barVertical', props: {}, dataUrl: '/p/shop/api/1', filterable: ['host'], table: 'default.http_logs', connection: 'default' };
    const add = () => [...bar.querySelectorAll<HTMLButtonElement>('.d-filter-bar__chips button')].find((b) => b.textContent === 'Add filter');
    expect(add()).toBeUndefined();

    show({ ...shop, title: 'Checkout', filterButtons: [], widgets: [byHost] as PageJson['widgets'] });
    addSql('a');

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

describe('filters, a field’s pill edited', () => {
  const byHost = { type: 'barVertical', props: {}, dataUrl: '/p/shop/api/1', filterable: ['host'], table: 'default.http_logs', connection: 'default' };
  /** The pill of host `op` `value` on http_logs, as `/p/shop/api/1/pill` answers it, and its chip. */
  const hostPill = (op: 'eq' | 'ne', value: string) => {
    const label = `host ${op === 'eq' ? '=' : '≠'} ${value}`;
    return { key: keyOf(label, { connection: 'default', table: 'default.http_logs', field: 'host', op, value }), label };
  };
  const hostChip = (op: 'eq' | 'ne', value: string) => ({ kind: 'pill', key: hostPill(op, value).key });
  /** What the value's quick pick is given, and what it answers next. */
  let valueBox: { title?: string; anchor?: unknown; items?: { label: string }[] } | undefined;
  let pickedValue: string | undefined;
  const op = (chip: HTMLElement) => chip.querySelector<HTMLButtonElement>('.d-filter-chip__op')!;
  const value = (chip: HTMLElement) => chip.querySelector<HTMLButtonElement>('button.d-filter-chip__value')!;

  beforeEach(() => {
    valueBox = undefined;
    pickedValue = undefined;
    (ui as Record<string, unknown>).createQuickPick = () => {
      const accepted: (() => void)[] = [];
      const hidden: (() => void)[] = [];
      const box = {
        value: '',
        selectedItems: [] as { value: string }[],
        onDidChangeValue: () => ({ dispose() {} }),
        onDidAccept: (f: () => void) => accepted.push(f),
        onDidHide: (f: () => void) => hidden.push(f),
        show: () => {
          valueBox = box as typeof valueBox;
          setTimeout(() => {
            if (pickedValue !== undefined) box.selectedItems = [{ value: pickedValue }];
            accepted.forEach((f) => f());
          });
        },
        hide: () => hidden.forEach((f) => f()),
        dispose: () => {},
      };
      return box;
    };
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      const args = new URL(url, 'http://x').searchParams;
      if (url.includes('/values')) return new Response(JSON.stringify({ type: 'String', values: ['b', 'c'] }));
      return new Response(JSON.stringify(hostPill(args.get('op') as 'eq' | 'ne', args.get('value')!)));
    });
    activate(true);
    show({ ...shop, filterButtons: [], widgets: [byHost] as PageJson['widgets'] });
  });

  it('shows its field, operator and value, each part on its own', () => {
    query.load({ search: `?f=${hostPill('ne', 'a').key}` });
    expect(chips().map(chipText)).toEqual(['host ≠ a']);
    expect([op(chips()[0]).title, value(chips()[0]).title]).toEqual(['Change the operator of host', 'Change the value of host']);
  });

  it('offers the ops of its type below the operator, and puts the pill made again with the one chosen in the chip’s place', async () => {
    query.load({ search: `?f=${keyOf('path = /a')}&f=${hostPill('eq', 'a').key}&sql=b` });
    picked = 'host ≠ a';
    op(chips()[1]).click();
    expect(picks).toEqual([{ labels: ['host = a', 'host ≠ a'], anchor: op(chips()[1]) }]);
    await vi.waitFor(() => expect(held()).toEqual([chipOf('path = /a'), hostChip('ne', 'a'), { kind: 'sql', sql: 'b' }]));
    expect(fetched).toEqual(['/p/shop/api/1/pill?field=host&op=ne&value=a']);
  });

  it('offers a time’s ops, asks its new value in an input box with the value in it, and sends the type along', async () => {
    const at = '2026-10-31T10:00:00.000Z';
    const since = { connection: 'default', table: 'default.http_logs', field: 'timestamp', op: 'ge', value: at, type: 'DateTime' };
    show({ ...shop, filterButtons: [], widgets: [{ ...byHost, filterable: ['timestamp'] }] as PageJson['widgets'] });
    query.load({ search: `?f=${keyOf(`timestamp ≥ ${at}`, since)}` });
    expect(chips().map(chipText)).toEqual([`timestamp ≥ ${at}`]);
    op(chips()[0]).click();
    expect(picks[0].labels).toEqual([`timestamp ≥ ${at}`, `timestamp ≤ ${at}`, `timestamp > ${at}`, `timestamp < ${at}`, `timestamp = ${at}`, `timestamp ≠ ${at}`]);

    answer = '2026-10-31T09:00:00Z';
    const clicked = value(chips()[0]);
    clicked.click();
    await vi.waitFor(() => expect(fetched.some((url) => url.includes('/pill'))).toBe(true));
    expect(asked).toEqual([expect.objectContaining({ title: 'timestamp ≥', value: at, anchor: clicked })]);
    expect(fetched.filter((url) => url.includes('/values'))).toEqual([]);
    expect(fetched.at(-1)).toBe(`/p/shop/api/1/pill?field=timestamp&op=ge&value=${encodeURIComponent(answer).replace(/%20/g, '+')}&type=DateTime`);
  });

  it('asks a new value in the quick pick of "Add filter" below the value, from the chart’s /values, and replaces the chip in place', async () => {
    query.load({ search: `?f=${hostPill('ne', 'a').key}&f=${hostPill('ne', 'z').key}` });
    pickedValue = 'b';
    const clicked = value(chips()[0]);
    clicked.click();
    await vi.waitFor(() => expect(held()).toEqual([hostChip('ne', 'b'), hostChip('ne', 'z')]));
    expect([valueBox?.title, valueBox?.anchor]).toEqual(['host ≠', clicked]);
    expect(fetched[0]).toMatch(/^\/p\/shop\/api\/1\/values\?.*field=host&search=$/);
    expect(fetched.at(-1)).toBe('/p/shop/api/1/pill?field=host&op=ne&value=b');
  });

  it('keeps the chip when no value is chosen, when the chart refuses, or when that chip changed meanwhile', async () => {
    query.load({ search: `?f=${hostPill('eq', 'a').key}` });
    value(chips()[0]).click();
    await vi.waitFor(() => expect(valueBox).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve));
    expect(fetched.some((url) => url.includes('/pill'))).toBe(false);

    picked = 'host ≠ a';
    op(chips()[0]).click();
    query.set(FILTERS, replaceChip(held(), 0, hostChip('eq', 'q') as FilterChip));
    await vi.waitFor(() => expect(fetched.some((url) => url.includes('/pill'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve));
    expect(held()).toEqual([hostChip('eq', 'q')]);
    query.set(FILTERS, replaceChip(held(), 0, hostChip('eq', 'a') as FilterChip));

    vi.stubGlobal('fetch', async () => new Response('"host" cannot filter this chart\'s table', { status: 422 }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    op(chips()[0]).click();
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    expect(held()[0]).toEqual(hostChip('eq', 'a'));
    logged.mockRestore();
  });

  it('only removes a pill no chart of the page makes, saying why', () => {
    query.load({ search: `?f=${hostPill('eq', 'a').key}` });
    show({ ...shop, filterButtons: [], widgets: [] });
    expect([op(chips()[0]), value(chips()[0])]).toEqual([null, null]);
    expect(chips().map(chipText)).toEqual(['host = a']);
    expect(chips()[0].title).toBe('host = a\nNo chart of this page filters default.http_logs by host, so it can only be removed');
  });
});

describe('filters with SQL filters off', () => {
  beforeEach(() => activate(false));

  it('still presses a filter button: its pill is signed', () => {
    button('Errors').click();
    expect([held(), button('Errors').getAttribute('aria-pressed')]).toEqual([[{ kind: 'pill', key: errorsKey }], 'true']);
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
    expect(held()).toEqual([]);
  });

  it('still shows the pills and "Add filter"', () => {
    const byHost = { type: 'barVertical', props: {}, dataUrl: '/p/shop/api/1', filterable: ['host'], table: 'default.http_logs', connection: 'default' };
    show({ ...shop, filterButtons: [], widgets: [byHost] as PageJson['widgets'] });
    addPill(pill('host = a'));
    expect(chips().map(chipText)).toEqual(['host = a']);
    expect([...bar.querySelectorAll('.d-filter-bar__chips button')].some((b) => b.textContent === 'Add filter')).toBe(true);
  });
});

describe('filters.addSql', () => {
  beforeEach(() => activate(true));

  it('adds a table cell’s condition as a SQL chip, once', () => {
    commands.get('filters.addSql')!("path LIKE '%/api%'");
    commands.get('filters.addSql')!("path LIKE '%/api%'");
    expect(held()).toEqual([{ kind: 'sql', sql: "path LIKE '%/api%'" }]);
  });
});

describe('filters.offer', () => {
  beforeEach(() => activate(true));

  it('offers a click’s candidates at the click and adds the pill chosen, made by the widget’s /pill, to the tab shown', async () => {
    picked = 'host = a';
    await commands.get('filters.offer')!({ x: 10, y: 20 }, [{ fieldId: 'host', value: 'a' }], { dataUrl: '/p/shop/api/1', filterable: ['host'] });

    expect(picks).toEqual([{ labels: ['host = a', 'host = a'], anchor: { x: 10, y: 20 } }]);
    expect(new URL(fetched.at(-1)!, 'http://x').pathname).toBe('/p/shop/api/1/pill');
    expect(held()).toHaveLength(1);
  });
});
