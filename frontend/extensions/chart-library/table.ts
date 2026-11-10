import { html } from 'htl';
import { DataType } from 'apache-arrow';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { CellComponent, ColumnComponent, ColumnDefinition, RowComponent } from 'tabulator-tables';
import type { TableProps } from '../../generated/zz_generated.dashica';
import type { MenuAnchor } from '../../hosts/ui/ui';
import type { QueryResult, WidgetContext, WidgetRecord } from '../../hosts/widgets/widgets';
import { columnTypesOf, dataPointOf } from './data-point';
import './table.css';

/**
 * The rows of `queryResult` as a table (Tabulator) below `props.title`: a search box, filters per column. With
 * `selectRecords`, a checkbox in front of each row (and one for all) ticks it, each change calling `selectRecords` with
 * the ticked rows. With `showDataPointMenu`, a click on a cell shows the data point menu of its value (`dataPointOf`,
 * with the column's type), its column's name the field; a NULL shows nothing. A column of `filterable` (the widget's,
 * page.json) is marked as one to filter by, a Map, Array or Tuple column (Arrow's map, list, struct) never. With
 * `showMenu`, a right click on a cell shows the menu
 * `table/cell` (a `TableCellMenuContext`), a column header's menu button the menu `table/header` (a
 * `TableHeaderMenuContext`); extensions add their entries there (the `table` extension: SQL filters, auto-size).
 */
export function drawTable(
  queryResult: QueryResult,
  props: TableProps,
  {
    showDataPointMenu,
    filterable = [],
    selectRecords,
    showMenu,
  }: {
    showDataPointMenu?: WidgetContext['showDataPointMenu'];
    filterable?: readonly string[];
    selectRecords?: (records: readonly WidgetRecord[]) => void;
    showMenu?: ShowTableMenu;
  } = {},
) {

  const data = queryResult.toArray().map((row: any) => row.toJSON());

  let searchTerm = '';

  const filtering = showDataPointMenu !== undefined;
  const categoryColumns = new Set(
    (queryResult?.schema?.fields ?? [])
      .filter((field: any) => filterable.includes(field.name))
      .filter((field: any) => !DataType.isMap(field) && !DataType.isList(field) && !DataType.isFixedSizeList(field) && !DataType.isStruct(field))
      .map((field: any) => field.name as string),
  );
  const filters = (fieldName: string) => filtering && categoryColumns.has(fieldName);

  const columns: ColumnDefinition[] = [];
  const timestampColumns = new Set<string>();
  queryResult?.schema?.fields?.forEach((field: any) => {
    const isTimestamp = DataType.isTimestamp(field) || field.name === 'timestamp';
    if (isTimestamp) timestampColumns.add(field.name);

    if (isTimestamp) {
      columns.push({
        title: field.name,
        field: field.name,
        formatter: (cell: CellComponent) => {
          const value = cell.getValue();
          // a number below 10 billion is seconds (a ClickHouse DateTime), else milliseconds as Date takes them
          const timestamp = value < 10000000000 ? value * 1000 : value;
          const dt = new Date(timestamp);
          const time = dt.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
          const date = dt.toLocaleDateString([], {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
          });
          const timeElement = document.createElement('div');
          timeElement.innerHTML = `${time} &nbsp; <span class="d-table__date">${date}</span>`;
          return timeElement;
        },
        cssClass: filters(field.name) ? 'd-table__filterable' : undefined,
      });
    } else {
      columns.push({
        title: field.name,
        field: field.name,
        cssClass: filters(field.name) ? 'd-table__filterable' : undefined,
      });
    }
  });

  const tableContainer = document.createElement('div');
  tableContainer.classList.add('d-table');
  if (filtering) tableContainer.classList.add('d-table--cell-menu');

  const searchInputElement = document.createElement('input');
  searchInputElement.type = 'text';
  searchInputElement.placeholder = 'Search records...';
  searchInputElement.classList.add('d-field', 'd-field--full', 'd-table__search');
  searchInputElement.addEventListener('input', (e) => {
    searchTerm = (e.target as HTMLInputElement).value;
    applySearch();
  });

  let tabulatorTable: Tabulator;
  function applySearch() {
    const needle = searchTerm.toLowerCase();

    if (!needle) {
      // false: the header filters stay
      tabulatorTable.clearFilter(false);
      return;
    }

    tabulatorTable.setFilter((rowData: any) => {
      const searchableText = Object.values(rowData)
        .map(v => String(v).toLowerCase())
        .join(' ');
      return searchableText.includes(needle);
    });
  }

  const tableRootContainer = document.createElement('div');
  tableRootContainer.classList.add("d-table__grid");

  // The search term highlighted in the cells rendered, with the CSS Custom Highlight API: one named highlight paints
  // ranges over them and leaves the DOM as it is, so the cells' own markup (a timestamp's) stays and Tabulator may reuse
  // rows on scroll, sort and filter. Painted again on each render; where the browser lacks the API, the search only
  // filters.
  function applySearchHighlight(term: string) {
    const highlights = (CSS as any).highlights;
    if (!highlights) return;
    highlights.delete('tableSearch');
    const needle = term.trim().toLowerCase();
    if (!needle) return;
    const rootElement = tableRootContainer.querySelector('.tabulator-tableholder');
    if (!rootElement) return;
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const hay = (node.nodeValue ?? '').toLowerCase();
      let from = 0, idx: number;
      while ((idx = hay.indexOf(needle, from)) !== -1) {
        const r = document.createRange();
        r.setStart(node, idx);
        r.setEnd(node, idx + needle.length);
        ranges.push(r);
        from = idx + needle.length;
      }
    }
    if (ranges.length) highlights.set('tableSearch', new (window as any).Highlight(...ranges));
  }

  tabulatorTable = new Tabulator(tableRootContainer, {
    height: props.height,
    maxHeight: "100vh",
    data: data,
    layout: "fitData",
    columns: columns,
    movableColumns: true,
    // the checkbox column, ticking rows
    rowHeader: selectRecords ? {
      formatter: "rowSelection",
      titleFormatter: "rowSelection",
      headerSort: false,
      resizable: false,
      frozen: true,
      headerHozAlign: "center",
      hozAlign: "center",
      // @ts-expect-error the types list only some column options for rowHeader, but Tabulator applies columnDefaults to it
      headerFilter: false // the checkbox column has no filter field
    } : undefined,
    columnDefaults: {
      headerFilter: "input", // a filter field in every column header
      headerFilterPlaceholder: "Filter...",
      titleFormatter: showMenu ? (cell) => headerTitle(cell.getValue(), cell.getColumn(), showMenu) : undefined,
    }
  });

  // the ticked rows, in the order ticked
  if (selectRecords) tabulatorTable.on("rowSelectionChanged", (records: WidgetRecord[]) => selectRecords(records));

  // a right click on a cell: the menu `table/cell`
  tabulatorTable.on("cellContext", (e: UIEvent, cell: CellComponent) => {
    if (!showMenu) return;
    e.preventDefault();
    const { clientX: x, clientY: y } = e as MouseEvent;
    const context: TableCellMenuContext = { column: cell.getField(), value: cell.getValue(), timestamp: timestampColumns.has(cell.getField()), filtering };
    showMenu('table/cell', { x, y }, context);
  });

  tabulatorTable.on("cellClick", (e: UIEvent, cell: CellComponent) => {
    const fieldName = cell.getField();
    const value = cell.getValue();
    if (!showDataPointMenu || value === null || value === undefined) return;
    showDataPointMenu(cell.getElement(), [dataPointOf(fieldName, value, columnTypesOf(queryResult))]);
  });

  // the highlights painted again on every render: a filter, a sort, rows reused while scrolling
  tabulatorTable.on("renderComplete", () => applySearchHighlight(searchTerm));

  tableContainer.appendChild(searchInputElement);
  tableContainer.appendChild(tableRootContainer);

  return tableContainer;
}

/** Shows the menu `menuId` at `anchor` for `context`, as `WidgetContext.showMenu` does for a widget. */
export type ShowTableMenu = (menuId: string, anchor: MenuAnchor, context: object) => void;

/** What the menu `table/cell` is shown for: a cell, by its column's name and its value. */
export interface TableCellMenuContext {
  readonly column: string;
  readonly value: unknown;
  /** Whether the column holds timestamps (a time type, or named `timestamp`). */
  readonly timestamp: boolean;
  /** Whether a click on a cell shows its data point menu (where the `filters` extension offers to filter by it). */
  readonly filtering: boolean;
}

/** What the menu `table/header` is shown for: a column, by its name, and how to size the columns to their rows. */
export interface TableHeaderMenuContext {
  readonly column: string;
  /** Sizes this column to its visible values. */
  autoSize(): void;
  /** Sizes every column to its visible values. */
  autoSizeAll(): void;
}

/** `raw` pretty-printed, when it is a JSON object or array; else `null`. */
export function tryPrettyJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return null;
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch (e) {
    return null;
  }
}

/** A column's title with its menu button, which shows `table/header` for it; the button's click stops before the sorting. */
function headerTitle(title: string, column: ColumnComponent, showMenu: ShowTableMenu): HTMLElement {
  const size = (c: ColumnComponent) => c.setWidth(calculateSizeOfColumn(c.getTable().getRows('visible'), c.getField()));
  const context: TableHeaderMenuContext = {
    column: column.getField(),
    autoSize: () => size(column),
    autoSizeAll: () => column.getTable().getColumns().forEach(size),
  };
  const buttonElement: HTMLButtonElement = html`<button type="button" class="d-table__header-menu" title="Column menu" aria-label=${`Menu of ${title}`} aria-haspopup="dialog"
    onclick=${(event: MouseEvent) => {
      event.stopPropagation();
      showMenu('table/header', buttonElement, context);
    }}>⋮</button>`;
  return html`<span class="d-table__header-title">${title}${buttonElement}</span>`;
}

function calculateSizeOfColumn(rows: RowComponent[], fieldName: string) {
  let ctx: CanvasRenderingContext2D | null = null;

  if (rows.length > 0) {
    const cell = rows[0].getCell(fieldName)
    if (!cell) {
      return true;
    }

    ctx = cell.getElement().ownerDocument.createElement('canvas').getContext('2d');
    if (!ctx) {
      return true;
    }

    const computedStyle = window.getComputedStyle(cell.getElement());
    const fontSize = computedStyle.getPropertyValue('font-size');
    const fontFamily = computedStyle.getPropertyValue('font-family');

    ctx.font = fontSize + " " + fontFamily;
  } else {
    return true;
  }

  let maxWidth = 0;
  rows.forEach(row => {
    let text = ctx.measureText(row.getData()[fieldName]);
    if (maxWidth < text.width) {
      maxWidth = text.width;
    }
  });

  return Math.ceil(maxWidth) + 10;
}
