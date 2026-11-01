import { html } from 'htl';
import { DataType } from 'apache-arrow';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { CellComponent, ColumnComponent, ColumnDefinition, RowComponent } from 'tabulator-tables';
import { Braces, Copy, Pin, X, createElement } from 'lucide';
import type { TableProps } from '../../generated/zz_generated.dashica';
import type { MenuAnchor } from '../../hosts/ui/ui';
import type { QueryResult, WidgetContext, WidgetRecord } from '../../hosts/widgets/widgets';
import { columnTypesOf, dataPointOf } from './data-point';
import './table.css';

/**
 * The rows of `queryResult` as a table (Tabulator) below `props.title`: a search box, filters per column, sticky
 * tooltips that can be pinned. With `selectRecords`, a checkbox in front of each row (and one for all) ticks it, each
 * change calling `selectRecords` with the ticked rows. With `showDataPointMenu`, a click on a cell of a column in
 * `filterable` (the widget's, page.json) shows the data point menu of its value (`dataPointOf`, with the column's
 * type), its column's name the field; a NULL shows nothing, and a Map, Array or Tuple column (Arrow's map, list,
 * struct) holds no category. With `showMenu`, a right click on a cell shows the menu
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

  // With `showDataPointMenu`, a click on a cell of a category column shows its value's menu (the cellClick handler below)
  const filtering = showDataPointMenu !== undefined;
  const categoryColumns = new Set(
    (queryResult?.schema?.fields ?? [])
      .filter((field: any) => filterable.includes(field.name))
      .filter((field: any) => !DataType.isMap(field) && !DataType.isList(field) && !DataType.isFixedSizeList(field) && !DataType.isStruct(field))
      .map((field: any) => field.name as string),
  );
  const filters = (fieldName: string) => filtering && categoryColumns.has(fieldName);

  // the columns, a timestamp's as its time and day
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

  // The search term highlighted wherever the widget shows it, the cells rendered and the sticky tooltips, with the CSS
  // Custom Highlight API: one named highlight paints ranges over all of them and leaves the DOM as it is, so the cells'
  // own markup (a timestamp's, the pins' badges) stays and Tabulator may reuse rows on scroll, sort and filter. Painted
  // again on each render and each tooltip shown or pinned; where the browser lacks the API, the search only filters.
  function applySearchHighlight(term: string) {
    const highlights = (CSS as any).highlights;
    if (!highlights) return;
    highlights.delete('tableSearch');
    const needle = term.trim().toLowerCase();
    if (!needle) return;
    const rootElements = [
      tableRootContainer.querySelector('.tabulator-tableholder'),
      // every tooltip, the hover one and the pinned ones, all in <body>
      ...document.querySelectorAll('.d-sticky-tooltip'),
    ].filter((rootElement): rootElement is Element => !!rootElement);
    const ranges: Range[] = [];
    for (const rootElement of rootElements) {
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
      tooltip: false, // the sticky tooltips instead (cellMouseEnter below)
      // the column's menu button: the menu `table/header`
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
    if (!showDataPointMenu || !filters(fieldName) || value === null || value === undefined) return;
    showDataPointMenu(cell.getElement(), [dataPointOf(fieldName, value, columnTypesOf(queryResult))]);
  });

  // the highlights painted again on every render: a filter, a sort, rows reused while scrolling
  tabulatorTable.on("renderComplete", () => applySearchHighlight(searchTerm));

  // the sticky tooltips: a hovered cell shows its full value; the pointer moves onto it to select and copy, pins it (its
  // cell marked [1], [2], …, its row tinted) or drags it
  const tooltipManager = createTooltipManager(tabulatorTable, () => applySearchHighlight(searchTerm));
  tabulatorTable.on("cellMouseEnter", (e: any, cell: CellComponent) => {
    tooltipManager.onCellEnter(e, cell);
  });
  tabulatorTable.on("cellMouseMove", (e: any) => {
    tooltipManager.onCellMove(e);
  });
  tabulatorTable.on("cellMouseLeave", () => {
    tooltipManager.onCellLeave();
  });

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

const canvasElement = document.createElement('canvas');
const ctx = canvasElement.getContext('2d');

function calculateSizeOfColumn(rows: RowComponent[], fieldName: string) {

  if (!ctx) {
    return true;
  }

  if (rows.length > 0) {
    const cell = rows[0].getCell(fieldName)
    if (!cell) {
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

/**
 * A table's tooltips: one hover tooltip and any number of pinned ones. A pinned one marks its source cell ([1], [2], …)
 * and tints its row in its colour, drawn again on every render of the rows, as Tabulator reuses their elements while
 * scrolling and filtering.
 */
function createTooltipManager(table: Tabulator, notifyRendered: () => void = () => {}) {
  const transient = createTooltip();
  transient.rootContainer.classList.add('d-sticky-tooltip--transient');
  transient.rootContainer.style.display = 'none';
  document.body.appendChild(transient.rootContainer);

  const pins: Pin[] = [];
  let nextIndex = 1;

  let showTimer: number | null = null;
  let hideTimer: number | null = null;
  // the cell whose value the hover tooltip shows, which Pin pins; the pointer crosses other cells on its way to the
  // tooltip
  let transientCell: CellComponent | null = null;
  let pointerX = 0;
  let pointerY = 0;

  function clearShowTimer() {
    if (showTimer !== null) { window.clearTimeout(showTimer); showTimer = null; }
  }
  function cancelHide() {
    if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
  }
  function hideTransient() {
    transient.rootContainer.style.display = 'none';
    transientCell = null;
  }
  function scheduleHide() {
    cancelHide();
    hideTimer = window.setTimeout(hideTransient, HIDE_DELAY);
  }

  function updateTransient(cell: CellComponent) {
    transientCell = cell;
    transient.setValue(String(cell.getValue()));
    transient.rootContainer.style.display = '';
    // the hover tooltip serves every cell: the size set for the value before goes, so it measures as large as this
    // value and keeps its place near the right edge
    transient.rootContainer.style.width = '';
    transient.rootContainer.style.height = '';
    positionTooltip(transient.rootContainer, pointerX, pointerY);
    notifyRendered(); // the search term highlighted in it
  }

  // the pins' badges and row tints on the rows rendered now, those of the render before removed first
  function decorate() {
    const tableElement = (table as any).element as HTMLElement | undefined;
    if (!tableElement) return;
    tableElement.querySelectorAll('.d-sticky-tooltip__badge').forEach(badgeElement => badgeElement.remove());
    tableElement.querySelectorAll('.d-sticky-tooltip__pinned-row').forEach(pinnedRowElement => {
      const rowElement = pinnedRowElement as HTMLElement;
      rowElement.classList.remove('d-sticky-tooltip__pinned-row');
      rowElement.style.removeProperty('box-shadow');
      rowElement.querySelectorAll('.tabulator-cell').forEach(cellElement => {
        (cellElement as HTMLElement).style.removeProperty('background-color');
      });
    });

    pins.forEach(pin => {
      let rowElement: HTMLElement | null = null;
      let cellElement: HTMLElement | null = null;
      try {
        rowElement = pin.row.getElement();
        const cell = pin.row.getCell(pin.field);
        cellElement = cell ? cell.getElement() : null;
      } catch (e) {
        return; // its row is gone or not rendered
      }
      if (rowElement) {
        rowElement.classList.add('d-sticky-tooltip__pinned-row');
        rowElement.style.boxShadow = `inset 3px 0 0 0 ${pin.color}`;
        // the tint on the scrolling cells only: the frozen checkbox column (position: sticky) covers the cells
        // scrolled under it while its background stays opaque, and a translucent tint would let their text through
        rowElement.querySelectorAll('.tabulator-cell:not(.tabulator-frozen)').forEach(scrollingCellElement => {
          (scrollingCellElement as HTMLElement).style.backgroundColor = pin.color + '14'; // ~8% alpha
        });
      }
      if (cellElement && !cellElement.querySelector('.d-sticky-tooltip__badge')) {
        const badgeElement = document.createElement('span');
        badgeElement.className = 'd-sticky-tooltip__badge';
        badgeElement.textContent = String(pin.index);
        badgeElement.style.backgroundColor = pin.color;
        cellElement.insertBefore(badgeElement, cellElement.firstChild);
      }
    });
  }

  function removePin(pin: Pin) {
    const i = pins.indexOf(pin);
    if (i >= 0) pins.splice(i, 1);
    pin.tooltip.rootContainer.remove();
    decorate();
  }

  function pinCurrent() {
    // the cell the hover tooltip shows, whatever cell the pointer crossed on its way to the tooltip
    if (!transientCell) return;
    const cell = transientCell;
    const pinned = createTooltip();
    pinned.rootContainer.classList.add('d-sticky-tooltip--pinned');
    pinned.pinButtonElement.style.display = 'none'; // already pinned

    const index = nextIndex++;
    const color = PIN_COLORS[(index - 1) % PIN_COLORS.length];
    pinned.indexLabelElement.textContent = String(index);
    pinned.indexLabelElement.style.display = '';
    pinned.indexLabelElement.style.backgroundColor = color;
    pinned.rootContainer.style.borderColor = color;

    pinned.setValue(String(cell.getValue()));
    document.body.appendChild(pinned.rootContainer);
    // where the hover tooltip sits: the pinned box stays in its place
    const tRect = transient.rootContainer.getBoundingClientRect();
    pinned.rootContainer.style.left = tRect.left + 'px';
    pinned.rootContainer.style.top = tRect.top + 'px';
    pinned.rootContainer.style.right = 'auto';
    pinned.rootContainer.style.bottom = 'auto';

    const pin: Pin = {tooltip: pinned, index, color, row: cell.getRow(), field: cell.getField()};
    pins.push(pin);
    pinned.closeButtonElement.addEventListener('click', () => removePin(pin));

    hideTransient();
    decorate();
    notifyRendered(); // the search term highlighted in it
  }

  // the hover tooltip stays while the pointer is on it, with the cell it shows: a cell crossed on the way shows none
  transient.rootContainer.addEventListener('mouseenter', () => { cancelHide(); clearShowTimer(); });
  transient.rootContainer.addEventListener('mouseleave', scheduleHide);
  transient.pinButtonElement.addEventListener('click', pinCurrent);
  // the hover tooltip hides as the pointer leaves it: a close button only on pinned ones
  transient.closeButtonElement.style.display = 'none';

  table.on('renderComplete', decorate);
  table.on('dataFiltered', decorate);
  table.on('dataSorted', decorate);

  function isPinned(cell: CellComponent): boolean {
    const row = cell.getRow();
    const field = cell.getField();
    return pins.some(p => p.row === row && p.field === field);
  }

  function onCellEnter(e: MouseEvent, cell: CellComponent) {
    pointerX = e.clientX;
    pointerY = e.clientY;
    const value = cell.getValue();
    if (value === null || value === undefined || value === '') {
      return;
    }
    // a pinned cell has its tooltip already
    if (isPinned(cell)) {
      clearShowTimer();
      hideTransient();
      return;
    }
    cancelHide();
    clearShowTimer();
    // each cell entered starts the delay anew; the tooltip shown stays until it ends, then shows the new cell (a swap
    // at once would blink)
    showTimer = window.setTimeout(() => updateTransient(cell), SHOW_DELAY);
  }

  // the pointer on a cell, where its tooltip shows once the delay ends
  function onCellMove(e: MouseEvent) {
    pointerX = e.clientX;
    pointerY = e.clientY;
  }

  function onCellLeave() {
    clearShowTimer();
    scheduleHide();
  }

  return {onCellEnter, onCellMove, onCellLeave};
}

/**
 * A cell's tooltip, the hover one or a pinned one: its elements and its value, shown as text or pretty-printed JSON;
 * dragged by its header while pinned. `createTooltipManager` wires pinning and closing.
 */
interface Tooltip {
  rootContainer: HTMLElement;
  headerContainer: HTMLElement;
  jsonButtonElement: HTMLButtonElement;
  copyButtonElement: HTMLButtonElement;
  pinButtonElement: HTMLButtonElement;
  closeButtonElement: HTMLButtonElement;
  indexLabelElement: HTMLElement;
  setValue(raw: string): void;
  currentText(): string;
}

function createTooltip(): Tooltip {
  const rootContainer = html`<div class="d-sticky-tooltip">
    <div class="d-sticky-tooltip__header">
      <span class="d-sticky-tooltip__index" style="display:none"></span>
      <button class="d-sticky-tooltip__btn d-sticky-tooltip__json" title="Toggle JSON pretty-print">${createElement(Braces, { width: 14, height: 14 })}</button>
      <button class="d-sticky-tooltip__btn d-sticky-tooltip__copy" title="Copy to clipboard">${createElement(Copy, { width: 14, height: 14 })}</button>
      <span class="d-sticky-tooltip__spacer"></span>
      <button class="d-sticky-tooltip__btn d-sticky-tooltip__pin" title="Pin (keeps this open + marks the source; drag header to move)">${createElement(Pin, { width: 14, height: 14 })}</button>
      <button class="d-sticky-tooltip__btn d-sticky-tooltip__close" title="Close">${createElement(X, { width: 14, height: 14 })}</button>
    </div>
    <pre class="d-sticky-tooltip__body"><code></code></pre>
  </div>` as HTMLElement;

  const headerContainer = rootContainer.querySelector('.d-sticky-tooltip__header') as HTMLElement;
  const indexLabelElement = rootContainer.querySelector('.d-sticky-tooltip__index') as HTMLElement;
  const jsonButtonElement = rootContainer.querySelector('.d-sticky-tooltip__json') as HTMLButtonElement;
  const copyButtonElement = rootContainer.querySelector('.d-sticky-tooltip__copy') as HTMLButtonElement;
  const pinButtonElement = rootContainer.querySelector('.d-sticky-tooltip__pin') as HTMLButtonElement;
  const closeButtonElement = rootContainer.querySelector('.d-sticky-tooltip__close') as HTMLButtonElement;
  const codeElement = rootContainer.querySelector('code') as HTMLElement;

  let currentRaw = '';
  let prettyJson: string | null = null;   // set while the value is JSON
  let showPretty = true;

  function renderBody() {
    codeElement.textContent = (prettyJson !== null && showPretty) ? prettyJson : currentRaw;
  }

  function setValue(raw: string) {
    currentRaw = raw;
    prettyJson = tryPrettyJson(raw);
    showPretty = true;
    jsonButtonElement.style.display = prettyJson !== null ? '' : 'none';
    renderBody();
  }

  function currentText(): string {
    return (prettyJson !== null && showPretty) ? prettyJson : currentRaw;
  }

  jsonButtonElement.addEventListener('click', () => {
    showPretty = !showPretty;
    renderBody();
  });

  copyButtonElement.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentText());
      copyButtonElement.classList.add('d-sticky-tooltip__btn--ok');
      window.setTimeout(() => copyButtonElement.classList.remove('d-sticky-tooltip__btn--ok'), 800);
    } catch (e) {
      console.warn('Clipboard write failed', e);
    }
  });

  let dragDX = 0;
  let dragDY = 0;

  function onDragMove(e: PointerEvent) {
    rootContainer.style.left = (e.clientX - dragDX) + 'px';
    rootContainer.style.top = (e.clientY - dragDY) + 'px';
    rootContainer.style.right = 'auto';
    rootContainer.style.bottom = 'auto';
  }

  function onDragEnd(e: PointerEvent) {
    headerContainer.releasePointerCapture(e.pointerId);
    headerContainer.removeEventListener('pointermove', onDragMove);
    headerContainer.removeEventListener('pointerup', onDragEnd);
  }

  headerContainer.addEventListener('pointerdown', (e) => {
    // only a pinned tooltip moves
    if (!rootContainer.classList.contains('d-sticky-tooltip--pinned')) {
      return;
    }
    if ((e.target as HTMLElement).closest('.d-sticky-tooltip__btn')) {
      return; // a press on a button stays a press
    }
    const rect = rootContainer.getBoundingClientRect();
    dragDX = e.clientX - rect.left;
    dragDY = e.clientY - rect.top;
    headerContainer.setPointerCapture(e.pointerId);
    headerContainer.addEventListener('pointermove', onDragMove);
    headerContainer.addEventListener('pointerup', onDragEnd);
    e.preventDefault();
  });

  return {rootContainer, headerContainer, jsonButtonElement, copyButtonElement, pinButtonElement, closeButtonElement, indexLabelElement, setValue, currentText};
}

interface Pin {
  tooltip: Tooltip;
  index: number;
  color: string;
  row: RowComponent;
  field: string;
}

/**
 * How long the pointer rests on a cell before its tooltip shows, in ms, so that a sweep across cells shows none; and
 * how long the tooltip stays once the pointer left the cell, so that the pointer can reach it.
 */
const SHOW_DELAY = 400;
const HIDE_DELAY = 300;

/** Puts a tooltip beside the pointer (`pointerX`, `pointerY`) within the viewport: next to the cursor also in a wide column. */
function positionTooltip(rootContainer: HTMLElement, pointerX: number, pointerY: number, offset = 0) {
  const ttRect = rootContainer.getBoundingClientRect();
  let left = pointerX + 12 + offset;
  let top = pointerY + 16 + offset;
  // left of the pointer where the right edge would cut it
  if (left + ttRect.width > window.innerWidth - 8) {
    left = Math.max(8, pointerX - ttRect.width - 12);
  }
  left = Math.max(8, left);
  // above the pointer where the bottom edge would cut it
  if (top + ttRect.height > window.innerHeight - 8) {
    top = Math.max(8, pointerY - ttRect.height - 12);
  }
  top = Math.max(8, top);
  rootContainer.style.left = left + 'px';
  rootContainer.style.top = top + 'px';
  rootContainer.style.right = 'auto';
  rootContainer.style.bottom = 'auto';
}

/** The colours the pinned tooltips take in turn, with their source cells' badges and rows. */
const PIN_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706',
  '#9333ea', '#0891b2', '#db2777', '#65a30d',
];
