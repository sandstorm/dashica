import type { Commands } from '../../hosts/commands/commands';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryResult, WidgetContext, WidgetOf, WidgetRecord } from '../../hosts/widgets/widgets';
import { ChartFrame } from '../chart-library/chart-frame';
import { offerFiltersOf } from '../chart-library/filter-on-click';
import { drawTable, type TableCellMenuContext, type TableHeaderMenuContext } from '../chart-library/table';

/**
 * The widget type `table`: the result rows (Tabulator) with a search box, filters per column, sticky tooltips that can
 * be pinned. Its ticked rows are its own: each change of them runs the command `details.showRecords` with the table
 * and its ticked rows (`{ widget, records }`, Details shows them), as does each answer and the table's removal when
 * they clear rows that were ticked. The press on a checkbox makes the table active, as any press in a widget does.
 * A click on a cell offers to filter by its value or exclude it (by its column's name; the command `filters.offer`).
 * The entries of every table's menus, the widget's and Debug's: a cell's (`table/cell`) add a condition to the
 * page's SQL filter, only while the server takes SQL chips (`workbench.json`'s `sqlEnabled`); a column header's
 * (`table/header`) size the columns.
 */
export const table: Extension = {
  id: 'table',
  activate: ({ widgets, commands, ui, query, page, subscriptions }) => {
    subscriptions.push(widgets.registerWidget('table', (el, widget, ctx) => renderTable(el, widget, ctx, commands)));
    for (const [order, filter] of page.workbench.sqlEnabled ? CELL_FILTERS.entries() : []) {
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

/** The command a table runs with `{ widget, records }` on each change of its ticked rows (the `details` extension's). */
const SHOW_RECORDS = 'details.showRecords';

function renderTable(el: HTMLElement, widget: WidgetOf<'table'>, ctx: WidgetContext, commands: Commands): { dispose(): void } {
  /** The ticked rows, in the order ticked. */
  let ticked: readonly WidgetRecord[] = [];
  const tick = (records: readonly WidgetRecord[]) => {
    if (records.length === 0 && ticked.length === 0) return;
    ticked = records;
    commands.executeCommand(SHOW_RECORDS, { widget, records }).catch((error: unknown) => console.error(`Command ${SHOW_RECORDS} failed:`, error));
  };
  // Tabulator fits a new width itself, and its colors are the page's: one table per answer, its ticks kept on a resize
  let drawn: { result: QueryResult; table: HTMLElement } | undefined;
  const frame = new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result) => {
      if (drawn?.result === result) return drawn.table;
      // the table of a new answer has no row ticked
      tick([]);
      const table = drawTable(result, widget.props, {
        offerFilters: offerFiltersOf(commands, widget),
        filterable: widget.filterable,
        selectRecords: tick,
        showMenu: (menuId, anchor, context) => ctx.showMenu(menuId, anchor, context),
      });
      drawn = { result, table };
      return table;
    },
  });
  return {
    dispose: () => {
      frame.dispose();
      tick([]);
    },
  };
}

// A time window of `ms` around a timestamp cell, in seconds
const around = (ms: number) => (cell: TableCellMenuContext) => {
  const at = new Date(cell.value as number).getTime();
  return `${cell.column} BETWEEN ${(at - ms) / 1000} AND ${(at + ms) / 1000}`;
};

/**
 * A cell's SQL filters, in menu order. A table whose cells filter on a click leaves "Equals" / "Not equals" to that
 * click's quick pick, and keeps the entries no filter op says.
 */
const CELL_FILTERS: readonly {
  command: string;
  title: string;
  when: (cell: TableCellMenuContext) => boolean;
  condition: (cell: TableCellMenuContext) => string;
}[] = [
  { command: 'table.filterEqualsTimestamp', title: 'Filter: Equals this timestamp', when: (c) => c.timestamp && !c.filtering, condition: (c) => `${c.column} = '${c.value}'` },
  { command: 'table.filterEquals', title: 'Filter: Equals this value', when: (c) => !c.timestamp && !c.filtering, condition: (c) => `${c.column} = '${c.value}'` },
  { command: 'table.filterNotEquals', title: 'Filter: Not equals this value', when: (c) => !c.timestamp && !c.filtering, condition: (c) => `${c.column} != '${c.value}'` },
  { command: 'table.filterContains', title: 'Filter: Contains this value', when: (c) => !c.timestamp, condition: (c) => `${c.column} LIKE '%${c.value}%'` },
  { command: 'table.filterTime5m', title: 'Filter: Time ±5 minutes', when: (c) => c.timestamp, condition: around(5 * 60 * 1000) },
  { command: 'table.filterTime1h', title: 'Filter: Time ±1 hour', when: (c) => c.timestamp, condition: around(60 * 60 * 1000) },
  { command: 'table.filterTime24h', title: 'Filter: Time ±24 hours', when: (c) => c.timestamp, condition: around(24 * 60 * 60 * 1000) },
];
