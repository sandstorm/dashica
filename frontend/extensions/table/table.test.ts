// @vitest-environment jsdom
// Tests for table.ts: the rows drawn into a table, ticked rows given to `details.showRecords`, a click on a cell of a
// category column running filters.offer with its value and the table's pills, a cell's menu (`table/cell`) adding a
// condition to the page's SQL filter (none while SQL filters are off), a column header's (`table/header`) sizing the
// columns.
import { Field, List, Table, Utf8, vectorFromArray } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { table } from './table';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(table);
  // Tabulator draws only the rows that fit its height, and jsdom lays out nothing; CSS: the search highlight
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
  vi.stubGlobal('CSS', {});
});

afterEach(() => {
  testbed.dispose();
  vi.restoreAllMocks();
});

const inView = async () => {
  testbed.resize(640);
  testbed.scrollIntoView();
  await settle();
};
const error = (el: HTMLElement) => el.querySelector('.d-widget-error')?.textContent;

const cellAt = (el: HTMLElement, column: string, row: number) =>
  el.querySelectorAll<HTMLElement>(`.tabulator-cell[tabulator-field="${column}"]`)[row];
// Right-clicks the cell in `column` of row `row` (0-based): the menu it shows, and its entries
const openCellMenu = (el: HTMLElement, column: string, row: number) => {
  cellAt(el, column, row).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }));
  const shown = testbed.menus.at(-1)!;
  return { ...shown, entries: testbed.ui.getMenuItems(shown.menuId, shown.options.context) };
};
const labels = (menu: ReturnType<typeof openCellMenu>) => menu.entries.map((entry) => entry.title);
const click = (menu: ReturnType<typeof openCellMenu>, label: string) =>
  testbed.commands.executeCommand(menu.entries.find((entry) => entry.title === label)!.command, ...(menu.options.args ?? []));

describe('table', () => {
  it('draws the rows below its title, which the chart frame shows', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { el } = testbed.render({ type: 'table', props: { title: 'Latest', height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelector('.d-chart-frame__title')!.textContent).toBe('Latest');
    expect(el.querySelectorAll('.tabulator-cell[tabulator-field="path"]')).toHaveLength(2);
  });

  it('gives its ticked rows to details.showRecords on each change; the press makes it active; a resize keeps them, a new answer and its removal clear them', async () => {
    const given: { widget: unknown; records: unknown }[] = [];
    testbed.commands.registerCommand('details.showRecords', (shown) => given.push(shown));
    const widget = { type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' } as const;
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { el, rendered } = testbed.render(widget);
    await inView();
    // a first answer, nothing ticked: nothing to tell
    expect(given).toEqual([]);
    expect(testbed.widgets.active).toBeUndefined();

    const tick = (row: number) => {
      const box = el.querySelectorAll<HTMLInputElement>('.tabulator-row input[type=checkbox]')[row];
      box.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      box.click();
    };
    tick(1);
    expect(testbed.widgets.active?.widget).toBe(widget);
    expect(given).toEqual([{ widget, records: [{ path: '/login', status: 500 }] }]);
    tick(0);
    expect(given.at(-1)).toEqual({ widget, records: [{ path: '/login', status: 500 }, { path: '/api', status: 200 }] });
    expect(el.querySelector('.d-record-panel')).toBeNull();

    const drawn = el.querySelector('.tabulator');
    testbed.resize(480);
    await settle();
    expect(el.querySelector('.tabulator')).toBe(drawn);
    expect(given).toHaveLength(2);
    expect(el.querySelectorAll('.tabulator-row input[type=checkbox]:checked')).toHaveLength(2);

    testbed.query.refresh();
    await settle();
    expect(given.at(-1)).toEqual({ widget, records: [] });
    expect(given).toHaveLength(3);
    tick(0);
    rendered.dispose();
    expect(given.slice(3)).toEqual([{ widget, records: [{ path: '/api', status: 200 }] }, { widget, records: [] }]);
  });

  it('offers the value of a clicked cell by its column’s name, below the cell, with the table’s pills', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1', filterable: ['path', 'status'] });
    await inView();

    const cell = cellAt(el, 'status', 1);
    expect(cell.classList.contains('d-table__filterable')).toBe(true);
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(testbed.offers).toEqual([{ at: cell, candidates: [{ fieldId: 'status', value: '500' }], source: { dataUrl: '/p/shop/api/1', filterable: ['path', 'status'] } }]);
  });

  it('offers nothing from a NULL cell', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', null], status: [200, 500] });
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1', filterable: ['path'] });
    await inView();

    cellAt(el, 'path', 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(testbed.offers).toEqual([]);
  });

  it('offers only in its category columns: a measure, or a table without categories, offers nothing', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api'], cnt: [3] });
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1', filterable: ['path'] });
    await inView();

    const cnt = cellAt(el, 'cnt', 0);
    expect(cnt.classList.contains('d-table__filterable')).toBe(false);
    cnt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(testbed.offers).toEqual([]);
    expect(cellAt(el, 'path', 0).classList.contains('d-table__filterable')).toBe(true);
  });

  it('offers nothing in a list column, even one named a category', async () => {
    testbed.serve('/p/shop/api/1/query', new Table({ tags: vectorFromArray([['a', 'b']], new List(new Field('item', new Utf8(), true))) }));
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1', filterable: ['tags'] });
    await inView();

    const tags = cellAt(el, 'tags', 0);
    expect(tags.classList.contains('d-table__filterable')).toBe(false);
    tags.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(testbed.offers).toEqual([]);
  });

  it('keeps only the SQL entries no filter op says in a cell’s menu', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api'] });
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();

    const menu = openCellMenu(el, 'path', 0);
    expect(menu).toMatchObject({ menuId: 'table/cell', options: { anchor: { x: 5, y: 6 }, context: { column: 'path', value: '/api', widget: { type: 'table' } } } });
    expect(labels(menu)).toEqual(['Filter: Contains this value']);
  });

  it('keeps the time window entries in SQL for a timestamp column', async () => {
    testbed.serve('/p/shop/api/1/query', { timestamp: [1761730000] });
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();

    expect(labels(openCellMenu(el, 'timestamp', 0))).toEqual(['Filter: Time ±5 minutes', 'Filter: Time ±1 hour', 'Filter: Time ±24 hours']);
  });

  it('has all SQL entries in the menu of a table whose cells do not filter on a click, and a time window around a timestamp', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api'], timestamp: [1761730000000] });
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();
    const unfiltering = (menu: ReturnType<typeof openCellMenu>) => ({ ...menu, entries: testbed.ui.getMenuItems<object>(menu.menuId, { ...menu.options.context, filtering: false }) });

    expect(labels(unfiltering(openCellMenu(el, 'path', 0)))).toEqual(['Filter: Equals this value', 'Filter: Not equals this value', 'Filter: Contains this value']);
    const time = unfiltering(openCellMenu(el, 'timestamp', 0));
    expect(labels(time)).toEqual(['Filter: Equals this timestamp', 'Filter: Time ±5 minutes', 'Filter: Time ±1 hour', 'Filter: Time ±24 hours']);
    await click(time, 'Filter: Time ±1 hour');
    expect(testbed.query.filters.chips).toEqual([{ kind: 'sql', sql: 'timestamp BETWEEN 1761726400 AND 1761733600' }]);
  });

  it('shows table/header from a column header’s menu button; its entries size the columns', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'] });
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();
    const button = el.querySelector<HTMLButtonElement>('.tabulator-col[tabulator-field="path"] .d-table__header-menu')!;
    button.click();
    const shown = testbed.menus.at(-1)!;
    expect(shown).toMatchObject({ menuId: 'table/header', options: { anchor: button, context: { column: 'path' } } });
    const entries = testbed.ui.getMenuItems(shown.menuId, shown.options.context);
    expect(entries.map((entry) => entry.title)).toEqual(['Auto-size column (based on visible data)', 'Auto-size all columns (based on visible data)']);
    const sized = vi.spyOn(shown.options.context as { autoSize(): void }, 'autoSize');
    await testbed.commands.executeCommand(entries[0].command, ...(shown.options.args ?? []));
    expect(sized).toHaveBeenCalled();
  });

  it('adds a SQL chip from a cell’s menu', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();

    await click(openCellMenu(el, 'path', 0), 'Filter: Contains this value');

    expect(testbed.query.filters.chips).toEqual([{ kind: 'sql', sql: "path LIKE '%/api%'" }]);
  });

  it('has no SQL entries in a cell’s menu while SQL filters are off', async () => {
    testbed.dispose();
    testbed = widgetTestbed({ sqlEnabled: false });
    testbed.activate(table);
    vi.stubGlobal('CSS', {});
    testbed.serve('/p/shop/api/1/query', { path: ['/api'], timestamp: [1761730000000] });
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();

    expect(labels(openCellMenu(el, 'path', 0))).toEqual([]);
    expect(labels(openCellMenu(el, 'timestamp', 0))).toEqual([]);
  });
});
