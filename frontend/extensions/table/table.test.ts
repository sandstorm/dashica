// @vitest-environment jsdom
// Tests for table.ts: the rows drawn into a table, a click on a cell of a category column selecting its value
// for the floating bar's filters, a cell's menu (`table/cell`) adding a condition to the page's SQL filter, a column
// header's (`table/header`) sizing the columns.
import { Field, List, Table, Utf8, vectorFromArray } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { filters } from '../filters/filters';
import { table } from './table';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(table, filters);
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
const entry = (title: string) => [...(testbed.floatingBar()?.querySelectorAll('button') ?? [])].find((button) => button.textContent === title);
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
  it('draws the rows below its title', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { el } = testbed.render({ type: 'table', props: { title: 'Latest', height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelector('.d-table h2')!.textContent).toBe('Latest');
    expect(el.querySelectorAll('.tabulator-cell[tabulator-field="path"]')).toHaveLength(2);
  });

  it('selects the value of a clicked cell by its column’s name; the floating bar filters by it', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { el } = testbed.render({ type: 'table', props: { height: 500, categories: ['path', 'status'] }, dataUrl: '/p/shop/api/1' });
    await inView();

    const cell = cellAt(el, 'status', 1);
    expect(cell.classList.contains('d-table__selectable')).toBe(true);
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(testbed.widgets.selection).toMatchObject({ kind: 'category', widgetId: '1', fieldId: 'status', value: '500', anchor: cell });
    entry('Exclude')!.click();

    expect(testbed.query.filters.chips).toEqual([{ kind: 'field', fieldId: 'status', op: 'ne', value: '500' }]);
  });

  it('selects nothing from a NULL cell', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', null], status: [200, 500] });
    const { el } = testbed.render({ type: 'table', props: { height: 500, categories: ['path'] }, dataUrl: '/p/shop/api/1' });
    await inView();

    cellAt(el, 'path', 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(testbed.widgets.selection).toBeUndefined();
  });

  it('selects only in its category columns: a measure, or a table without categories, selects nothing', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api'], cnt: [3] });
    const { el } = testbed.render({ type: 'table', props: { height: 500, categories: ['path'] }, dataUrl: '/p/shop/api/1' });
    await inView();

    const cnt = cellAt(el, 'cnt', 0);
    expect(cnt.classList.contains('d-table__selectable')).toBe(false);
    cnt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(testbed.widgets.selection).toBeUndefined();
    expect(cellAt(el, 'path', 0).classList.contains('d-table__selectable')).toBe(true);
  });

  it('selects nothing in a list column, even one named a category', async () => {
    testbed.serve('/p/shop/api/1/query', new Table({ tags: vectorFromArray([['a', 'b']], new List(new Field('item', new Utf8(), true))) }));
    const { el } = testbed.render({ type: 'table', props: { height: 500, categories: ['tags'] }, dataUrl: '/p/shop/api/1' });
    await inView();

    const tags = cellAt(el, 'tags', 0);
    expect(tags.classList.contains('d-table__selectable')).toBe(false);
    tags.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(testbed.widgets.selection).toBeUndefined();
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

  it('has all SQL entries in the menu of a table that does not select, and a time window around a timestamp', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api'], timestamp: [1761730000000] });
    const { el } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();
    const unselecting = (menu: ReturnType<typeof openCellMenu>) => ({ ...menu, entries: testbed.ui.getMenuItems<object>(menu.menuId, { ...menu.options.context, selecting: false }) });

    expect(labels(unselecting(openCellMenu(el, 'path', 0)))).toEqual(['Filter: Equals this value', 'Filter: Not equals this value', 'Filter: Contains this value']);
    const time = unselecting(openCellMenu(el, 'timestamp', 0));
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
});
