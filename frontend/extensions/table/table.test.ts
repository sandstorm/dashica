// @vitest-environment jsdom
// Tests for table.ts: the rows drawn into a table, ticked rows given to `details.showRecords`, a click on a cell of a
// category column showing the data point menu of its value for the table, a cell's menu (`table/cell`) adding a
// condition to the page's SQL filter by `filters.addSql` (none while SQL filters are off), a column header's
// (`table/header`) sizing the columns.
import { Field, List, Table, Utf8, vectorFromArray } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle, widgetTestbed, dataUrlOf, type RecordedDataPointMenu } from '../../hosts/widgets/widgets-testing';
import { table } from './table';

let testbed: ReturnType<typeof widgetTestbed>;
/** The data point menus shown, in order: what each click showed. */
let offers: readonly RecordedDataPointMenu[];
/** The conditions a cell's SQL filter added through `filters.addSql`, the filters extension's, in order. */
let addedSql: string[];

beforeEach(() => {
  testbed = widgetTestbed();
  offers = testbed.dataPointMenus;
  addedSql = [];
  testbed.commands.registerCommand('filters.addSql', (condition: string) => void addedSql.push(condition));
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
const error = (widgetContainer: HTMLElement) => widgetContainer.querySelector('.d-widget-error')?.textContent;

const cellAt = (widgetContainer: HTMLElement, column: string, row: number) =>
  widgetContainer.querySelectorAll<HTMLElement>(`.tabulator-cell[tabulator-field="${column}"]`)[row];
// Right-clicks the cell in `column` of row `row` (0-based): the menu it shows, and its entries
const openCellMenu = (widgetContainer: HTMLElement, column: string, row: number) => {
  cellAt(widgetContainer, column, row).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }));
  const shown = testbed.menus.at(-1)!;
  return { ...shown, entries: testbed.ui.getMenuItems(shown.menuId, shown.options.context) };
};
const labels = (menu: ReturnType<typeof openCellMenu>) => menu.entries.map((entry) => entry.title);
const click = (menu: ReturnType<typeof openCellMenu>, label: string) =>
  testbed.commands.executeCommand(menu.entries.find((entry) => entry.title === label)!.command, ...(menu.options.args ?? []));

describe('table', () => {
  it('draws the rows below its title, which the chart frame shows', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { widgetContainer } = testbed.render({ type: 'table', props: { title: 'Latest', height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(error(widgetContainer)).toBeUndefined();
    expect(widgetContainer.querySelector('.d-chart-frame__title')!.textContent).toBe('Latest');
    expect(widgetContainer.querySelectorAll('.tabulator-cell[tabulator-field="path"]')).toHaveLength(2);
  });

  it('gives its ticked rows to details.showRecords on each change; the press makes it active; a resize keeps them, a new answer and its removal clear them', async () => {
    const given: { widget: unknown; records: unknown }[] = [];
    testbed.commands.registerCommand('details.showRecords', (shown) => given.push(shown));
    const widget = { type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' } as const;
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { widgetContainer, rendered } = testbed.render(widget);
    await inView();
    // a first answer, nothing ticked: nothing to tell
    expect(given).toEqual([]);
    expect(testbed.widgets.active).toBeUndefined();

    const tick = (row: number) => {
      const checkboxElement = widgetContainer.querySelectorAll<HTMLInputElement>('.tabulator-row input[type=checkbox]')[row];
      checkboxElement.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      checkboxElement.click();
    };
    tick(1);
    expect(testbed.widgets.active?.widget).toBe(widget);
    expect(given).toEqual([{ widget, records: [{ path: '/login', status: 500 }] }]);
    tick(0);
    expect(given.at(-1)).toEqual({ widget, records: [{ path: '/login', status: 500 }, { path: '/api', status: 200 }] });
    expect(widgetContainer.querySelector('.d-record-panel')).toBeNull();

    const drawnElement = widgetContainer.querySelector('.tabulator');
    testbed.resize(480);
    await settle();
    expect(widgetContainer.querySelector('.tabulator')).toBe(drawnElement);
    expect(given).toHaveLength(2);
    expect(widgetContainer.querySelectorAll('.tabulator-row input[type=checkbox]:checked')).toHaveLength(2);

    testbed.query.refresh();
    await settle();
    expect(given.at(-1)).toEqual({ widget, records: [] });
    expect(given).toHaveLength(3);
    tick(0);
    rendered.dispose();
    expect(given.slice(3)).toEqual([{ widget, records: [{ path: '/api', status: 200 }] }, { widget, records: [] }]);
  });

  it('offers the value of a clicked cell by its column’s name, below the cell, for the table', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1', filterable: ['path', 'status'] });
    await inView();

    const cellElement = cellAt(widgetContainer, 'status', 1);
    expect(cellElement.classList.contains('d-table__filterable')).toBe(true);
    cellElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(offers.map(({ at, dataPoints, widget }) => ({ at, dataPoints, dataUrl: dataUrlOf(widget) }))).toEqual([{ at: cellElement, dataPoints: [{ field: 'status', value: '500' }], dataUrl: '/p/shop/api/1' }]);
  });

  it('offers a timestamp cell as ISO 8601 with its column’s ClickHouse type', async () => {
    const at = Date.UTC(2026, 9, 31, 10, 0, 0);
    testbed.serve('/p/shop/api/1/query', { timestamp: [at / 1000] }, { 'X-Dashica-Column-Types': '{"timestamp":"DateTime"}' });
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1', filterable: ['timestamp'] });
    await inView();

    cellAt(widgetContainer, 'timestamp', 0).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(offers.at(-1)?.dataPoints).toEqual([{ field: 'timestamp', value: '2026-10-31T10:00:00.000Z', type: 'DateTime' }]);
  });

  it('offers nothing from a NULL cell', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', null], status: [200, 500] });
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1', filterable: ['path'] });
    await inView();

    cellAt(widgetContainer, 'path', 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(offers).toEqual([]);
  });

  it('offers only in its category columns: a measure, or a table without categories, offers nothing', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api'], cnt: [3] });
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1', filterable: ['path'] });
    await inView();

    const countCellElement = cellAt(widgetContainer, 'cnt', 0);
    expect(countCellElement.classList.contains('d-table__filterable')).toBe(false);
    countCellElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(offers).toEqual([]);
    expect(cellAt(widgetContainer, 'path', 0).classList.contains('d-table__filterable')).toBe(true);
  });

  it('offers nothing in a list column, even one named a category', async () => {
    testbed.serve('/p/shop/api/1/query', new Table({ tags: vectorFromArray([['a', 'b']], new List(new Field('item', new Utf8(), true))) }));
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1', filterable: ['tags'] });
    await inView();

    const tagsElement = cellAt(widgetContainer, 'tags', 0);
    expect(tagsElement.classList.contains('d-table__filterable')).toBe(false);
    tagsElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(offers).toEqual([]);
  });

  it('keeps only the SQL entries no filter op says in a cell’s menu', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api'] });
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();

    const menu = openCellMenu(widgetContainer, 'path', 0);
    expect(menu).toMatchObject({ menuId: 'table/cell', options: { anchor: { x: 5, y: 6 }, context: { column: 'path', value: '/api', widget: { type: 'table' } } } });
    expect(labels(menu)).toEqual(['Filter: Contains this value']);
  });

  it('keeps the time window entries in SQL for a timestamp column', async () => {
    testbed.serve('/p/shop/api/1/query', { timestamp: [1761730000] });
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();

    expect(labels(openCellMenu(widgetContainer, 'timestamp', 0))).toEqual(['Filter: Time ±5 minutes', 'Filter: Time ±1 hour', 'Filter: Time ±24 hours']);
  });

  it('has all SQL entries in the menu of a table whose cells do not filter on a click, and a time window around a timestamp', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api'], timestamp: [1761730000000] });
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();
    const unfiltering = (menu: ReturnType<typeof openCellMenu>) => ({ ...menu, entries: testbed.ui.getMenuItems<object>(menu.menuId, { ...menu.options.context, filtering: false }) });

    expect(labels(unfiltering(openCellMenu(widgetContainer, 'path', 0)))).toEqual(['Filter: Equals this value', 'Filter: Not equals this value', 'Filter: Contains this value']);
    const time = unfiltering(openCellMenu(widgetContainer, 'timestamp', 0));
    expect(labels(time)).toEqual(['Filter: Equals this timestamp', 'Filter: Time ±5 minutes', 'Filter: Time ±1 hour', 'Filter: Time ±24 hours']);
    await click(time, 'Filter: Time ±1 hour');
    expect(addedSql).toEqual(['timestamp BETWEEN 1761726400 AND 1761733600']);
  });

  it('shows table/header from a column header’s menu button; its entries size the columns', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'] });
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();
    const buttonElement = widgetContainer.querySelector<HTMLButtonElement>('.tabulator-col[tabulator-field="path"] .d-table__header-menu')!;
    buttonElement.click();
    const shown = testbed.menus.at(-1)!;
    expect(shown).toMatchObject({ menuId: 'table/header', options: { anchor: buttonElement, context: { column: 'path' } } });
    const entries = testbed.ui.getMenuItems(shown.menuId, shown.options.context);
    expect(entries.map((entry) => entry.title)).toEqual(['Auto-size column (based on visible data)', 'Auto-size all columns (based on visible data)']);
    const sized = vi.spyOn(shown.options.context as { autoSize(): void }, 'autoSize');
    await testbed.commands.executeCommand(entries[0].command, ...(shown.options.args ?? []));
    expect(sized).toHaveBeenCalled();
  });

  it('adds a SQL chip from a cell’s menu', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();

    await click(openCellMenu(widgetContainer, 'path', 0), 'Filter: Contains this value');

    expect(addedSql).toEqual(["path LIKE '%/api%'"]);
  });

  it('has no SQL entries in a cell’s menu while SQL filters are off', async () => {
    testbed.dispose();
    testbed = widgetTestbed({ sqlEnabled: false });
    offers = testbed.dataPointMenus;
    testbed.activate(table);
    vi.stubGlobal('CSS', {});
    testbed.serve('/p/shop/api/1/query', { path: ['/api'], timestamp: [1761730000000] });
    const { widgetContainer } = testbed.render({ type: 'table', props: { height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();

    expect(labels(openCellMenu(widgetContainer, 'path', 0))).toEqual([]);
    expect(labels(openCellMenu(widgetContainer, 'timestamp', 0))).toEqual([]);
  });
});
