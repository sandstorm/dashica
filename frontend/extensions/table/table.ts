import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type QueryResult, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';
import { drawTable, type TableCellMenuContext, type TableHeaderMenuContext } from '../chart-library/table';

/**
 * The widget type `table`: the result rows (Tabulator) with a search box, filters per column, sticky tooltips that can
 * be pinned. The ticked rows are the widget's selected records (Details shows them); each answer starts with none.
 * A click on a cell selects its value (by its column's name).
 * The entries of every table's menus, the widget's and Debug's: a cell's (`table/cell`) add a condition to the
 * page's SQL filter, a column header's (`table/header`) size the columns.
 */
export const table: Extension = {
  id: 'table',
  activate: ({ widgets, commands, ui, query, subscriptions }) => {
    subscriptions.push(widgets.registerWidget('table', renderTable));
    for (const [order, filter] of CELL_FILTERS.entries()) {
      subscriptions.push(commands.registerCommand(filter.command, (cell: TableCellMenuContext) => query.filters.add(filter.condition(cell))));
      subscriptions.push(ui.registerMenuItem<TableCellMenuContext>('table/cell', { command: filter.command, title: filter.title, when: filter.when, order }));
    }
    subscriptions.push(
      commands.registerCommand('table.autoSizeColumn', (header: TableHeaderMenuContext) => header.autoSize()),
      commands.registerCommand('table.autoSizeColumns', (header: TableHeaderMenuContext) => header.autoSizeAll()),
      ui.registerMenuItem('table/header', { command: 'table.autoSizeColumn', title: 'Auto-size column (based on visible data)', order: 0 }),
      ui.registerMenuItem('table/header', { command: 'table.autoSizeColumns', title: 'Auto-size all columns (based on visible data)', order: 1 }),
    );
  },
};

function renderTable(el: HTMLElement, widget: WidgetOf<'table'>, ctx: WidgetContext): ChartFrame {
  // Tabulator fits a new width itself, and its colors are the page's: one table per answer, its ticks kept on a resize
  let drawn: { result: QueryResult; table: HTMLElement } | undefined;
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result) => {
      if (drawn?.result === result) return drawn.table;
      // the table of a new answer has no row ticked
      ctx.selectRecords([]);
      const table = drawTable(result, widget.props, {
        select: (selection) => ctx.select(selection),
        selectRecords: (records) => ctx.selectRecords(records),
        showMenu: (menuId, anchor, context) => ctx.showMenu(menuId, anchor, context),
      });
      drawn = { result, table };
      return table;
    },
  });
}

// A time window of `ms` around a timestamp cell, in seconds
const around = (ms: number) => (cell: TableCellMenuContext) => {
  const at = new Date(cell.value as number).getTime();
  return `${cell.column} BETWEEN ${(at - ms) / 1000} AND ${(at + ms) / 1000}`;
};

/**
 * A cell's SQL filters, in menu order. A table that selects leaves "Equals" / "Not equals" to the floating bar
 * ("Filter by …" / "Exclude …"), and keeps the entries no filter op says.
 */
const CELL_FILTERS: readonly {
  command: string;
  title: string;
  when: (cell: TableCellMenuContext) => boolean;
  condition: (cell: TableCellMenuContext) => string;
}[] = [
  { command: 'table.filterEqualsTimestamp', title: 'Filter: Equals this timestamp', when: (c) => c.timestamp && !c.selecting, condition: (c) => `${c.column} = '${c.value}'` },
  { command: 'table.filterEquals', title: 'Filter: Equals this value', when: (c) => !c.timestamp && !c.selecting, condition: (c) => `${c.column} = '${c.value}'` },
  { command: 'table.filterNotEquals', title: 'Filter: Not equals this value', when: (c) => !c.timestamp && !c.selecting, condition: (c) => `${c.column} != '${c.value}'` },
  { command: 'table.filterContains', title: 'Filter: Contains this value', when: (c) => !c.timestamp, condition: (c) => `${c.column} LIKE '%${c.value}%'` },
  { command: 'table.filterTime5m', title: 'Filter: Time ±5 minutes', when: (c) => c.timestamp, condition: around(5 * 60 * 1000) },
  { command: 'table.filterTime1h', title: 'Filter: Time ±1 hour', when: (c) => c.timestamp, condition: around(60 * 60 * 1000) },
  { command: 'table.filterTime24h', title: 'Filter: Time ±24 hours', when: (c) => c.timestamp, condition: around(24 * 60 * 60 * 1000) },
];
