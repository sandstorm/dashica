import { html } from 'htl';
import { DataType } from 'apache-arrow';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { CellComponent, ColumnComponent, ColumnDefinition, RowComponent } from 'tabulator-tables';
import { Braces, Copy, Pin, X, createElement } from 'lucide';
import type { TableProps } from '../../generated/zz_generated.dashica';
import type { MenuAnchor } from '../../hosts/ui/ui';
import type { QueryResult, WidgetContext, WidgetRecord } from '../../hosts/widgets/widgets';
import './table.css';

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

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

// Colors cycled through for pinned tooltips + their source markers/rows.
const PIN_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706',
  '#9333ea', '#0891b2', '#db2777', '#65a30d',
];

// Delays (ms). Show-delay avoids tooltips flashing while the pointer sweeps
// across cells; hide-delay bridges the gap so the pointer can travel from the
// cell onto the tooltip without it vanishing.
const SHOW_DELAY = 400;
const HIDE_DELAY = 300;

// One tooltip DOM element (transient hover tooltip or a pinned one). Owns its
// own value/JSON/drag state; pin + close behaviour is wired up by the manager.
interface TooltipEl {
  root: HTMLElement;
  header: HTMLElement;
  jsonBtn: HTMLButtonElement;
  copyBtn: HTMLButtonElement;
  pinBtn: HTMLButtonElement;
  closeBtn: HTMLButtonElement;
  indexLabel: HTMLElement;
  setValue(raw: string): void;
  currentText(): string;
}

function createTooltipEl(): TooltipEl {
  // Build the static skeleton with htl (the house style in this file for one-shot DOM);
  // grab element refs afterwards. Behaviour (drag/position/pin) is wired
  // imperatively — see the note in `drawTable()`.
  const root = html`<div class="d-sticky-tooltip">
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

  const header = root.querySelector('.d-sticky-tooltip__header') as HTMLElement;
  const indexLabel = root.querySelector('.d-sticky-tooltip__index') as HTMLElement;
  const jsonBtn = root.querySelector('.d-sticky-tooltip__json') as HTMLButtonElement;
  const copyBtn = root.querySelector('.d-sticky-tooltip__copy') as HTMLButtonElement;
  const pinBtn = root.querySelector('.d-sticky-tooltip__pin') as HTMLButtonElement;
  const closeBtn = root.querySelector('.d-sticky-tooltip__close') as HTMLButtonElement;
  const code = root.querySelector('code') as HTMLElement;

  let currentRaw = '';
  let prettyJson: string | null = null;   // non-null => value is JSON
  let showPretty = true;

  function renderBody() {
    code.textContent = (prettyJson !== null && showPretty) ? prettyJson : currentRaw;
  }

  function setValue(raw: string) {
    currentRaw = raw;
    prettyJson = tryPrettyJson(raw);
    showPretty = true;
    jsonBtn.style.display = prettyJson !== null ? '' : 'none';
    renderBody();
  }

  function currentText(): string {
    return (prettyJson !== null && showPretty) ? prettyJson : currentRaw;
  }

  jsonBtn.addEventListener('click', () => {
    showPretty = !showPretty;
    renderBody();
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentText());
      copyBtn.classList.add('d-sticky-tooltip__btn--ok');
      window.setTimeout(() => copyBtn.classList.remove('d-sticky-tooltip__btn--ok'), 800);
    } catch (e) {
      console.warn('Clipboard write failed', e);
    }
  });

  // --- dragging via header (only when pinned/sticky) ---
  let dragDX = 0;
  let dragDY = 0;

  function onDragMove(e: PointerEvent) {
    root.style.left = (e.clientX - dragDX) + 'px';
    root.style.top = (e.clientY - dragDY) + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  function onDragEnd(e: PointerEvent) {
    header.releasePointerCapture(e.pointerId);
    header.removeEventListener('pointermove', onDragMove);
    header.removeEventListener('pointerup', onDragEnd);
  }

  header.addEventListener('pointerdown', (e) => {
    // Transient (unpinned) tooltip is not draggable.
    if (!root.classList.contains('d-sticky-tooltip--pinned')) {
      return;
    }
    if ((e.target as HTMLElement).closest('.d-sticky-tooltip__btn')) {
      return; // don't start a drag from a button
    }
    const rect = root.getBoundingClientRect();
    dragDX = e.clientX - rect.left;
    dragDY = e.clientY - rect.top;
    header.setPointerCapture(e.pointerId);
    header.addEventListener('pointermove', onDragMove);
    header.addEventListener('pointerup', onDragEnd);
    e.preventDefault();
  });

  return {root, header, jsonBtn, copyBtn, pinBtn, closeBtn, indexLabel, setValue, currentText};
}

// Position a tooltip near the mouse pointer, clamped to the viewport. Anchoring
// to the pointer (not the cell's left edge) keeps the tooltip next to the cursor
// even in very wide columns, where the cell's left edge can be far away.
function positionTooltip(root: HTMLElement, pointerX: number, pointerY: number, offset = 0) {
  const ttRect = root.getBoundingClientRect();
  let left = pointerX + 12 + offset;
  let top = pointerY + 16 + offset;
  // Flip left if it would overflow the right edge.
  if (left + ttRect.width > window.innerWidth - 8) {
    left = Math.max(8, pointerX - ttRect.width - 12);
  }
  left = Math.max(8, left);
  // Flip above the pointer if it would overflow the bottom edge.
  if (top + ttRect.height > window.innerHeight - 8) {
    top = Math.max(8, pointerY - ttRect.height - 12);
  }
  top = Math.max(8, top);
  root.style.left = left + 'px';
  root.style.top = top + 'px';
  root.style.right = 'auto';
  root.style.bottom = 'auto';
}

interface Pin {
  el: TooltipEl;
  index: number;
  color: string;
  row: RowComponent;
  field: string;
}

// Per-table tooltip manager: one transient hover tooltip plus any number of
// pinned tooltips. Pinned tooltips mark their source cell ([1], [2], …) and
// highlight the source row in a matching color. Re-decorates on every render
// so markers survive scrolling/filtering (Tabulator recycles row DOM).
function createTooltipManager(table: Tabulator, notifyRendered: () => void = () => {}) {
  const transient = createTooltipEl();
  transient.root.classList.add('d-sticky-tooltip--transient');
  transient.root.style.display = 'none';
  document.body.appendChild(transient.root);

  const pins: Pin[] = [];
  let nextIndex = 1;

  let showTimer: number | null = null;
  let hideTimer: number | null = null;
  // The cell whose value the transient tooltip currently *displays*. This is
  // NOT the same as hoverCell: on the way to the tooltip the pointer crosses
  // other cells (updating hoverCell), but the visible tooltip still shows this
  // one — and Pin must capture what's shown, not the last cell crossed.
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
    transient.root.style.display = 'none';
    transientCell = null;
  }
  function scheduleHide() {
    cancelHide();
    hideTimer = window.setTimeout(hideTransient, HIDE_DELAY);
  }

  function updateTransient(cell: CellComponent) {
    transientCell = cell;
    transient.setValue(String(cell.getValue()));
    transient.root.style.display = '';
    // The transient element is shared across cells. Clear any inline size
    // left over from a previous (wider) value so it re-shrinks to the new
    // content before we measure — otherwise a stale-wide box gets clamped
    // too far left when hovering cells near the right edge.
    transient.root.style.width = '';
    transient.root.style.height = '';
    positionTooltip(transient.root, pointerX, pointerY);
    notifyRendered(); // re-highlight search term inside the tooltip
  }

  // Re-apply source markers + row highlights for all pins. Runs on every
  // render, so it first strips stale decoration then re-adds it for whichever
  // pinned rows are currently rendered.
  function decorate() {
    const tableEl = (table as any).element as HTMLElement | undefined;
    if (!tableEl) return;
    tableEl.querySelectorAll('.d-sticky-tooltip__badge').forEach(n => n.remove());
    tableEl.querySelectorAll('.d-sticky-tooltip__pinned-row').forEach(n => {
      const row = n as HTMLElement;
      row.classList.remove('d-sticky-tooltip__pinned-row');
      row.style.removeProperty('box-shadow');
      row.querySelectorAll('.tabulator-cell').forEach(c => {
        (c as HTMLElement).style.removeProperty('background-color');
      });
    });

    pins.forEach(pin => {
      let rowEl: HTMLElement | null = null;
      let cellEl: HTMLElement | null = null;
      try {
        rowEl = pin.row.getElement();
        const cell = pin.row.getCell(pin.field);
        cellEl = cell ? cell.getElement() : null;
      } catch (e) {
        return; // row no longer exists / not rendered
      }
      if (rowEl) {
        rowEl.classList.add('d-sticky-tooltip__pinned-row');
        rowEl.style.boxShadow = `inset 3px 0 0 0 ${pin.color}`;
        // Tint only the scrolling cells, never the frozen (checkbox)
        // column. The frozen column is position:sticky and hides the
        // horizontally-scrolled cells sliding under it *only* while its
        // background stays opaque. A translucent (8%-alpha) tint on the
        // row would make the frozen cell see-through and the scrolled
        // text would bleed through it. Leaving frozen cells untouched
        // keeps their solid Tabulator background — same as an unpinned
        // row, which is exactly why unpinned rows never showed the bug.
        rowEl.querySelectorAll('.tabulator-cell:not(.tabulator-frozen)').forEach(c => {
          (c as HTMLElement).style.backgroundColor = pin.color + '14'; // ~8% alpha
        });
      }
      if (cellEl && !cellEl.querySelector('.d-sticky-tooltip__badge')) {
        const badge = document.createElement('span');
        badge.className = 'd-sticky-tooltip__badge';
        badge.textContent = String(pin.index);
        badge.style.backgroundColor = pin.color;
        cellEl.insertBefore(badge, cellEl.firstChild);
      }
    });
  }

  function removePin(pin: Pin) {
    const i = pins.indexOf(pin);
    if (i >= 0) pins.splice(i, 1);
    pin.el.root.remove();
    decorate();
  }

  function pinCurrent() {
    // Pin what the tooltip actually shows, not the last cell the pointer
    // crossed on its way here (that would pin the wrong column).
    if (!transientCell) return;
    const cell = transientCell;
    const pinned = createTooltipEl();
    pinned.root.classList.add('d-sticky-tooltip--pinned');
    pinned.pinBtn.style.display = 'none'; // already pinned

    const index = nextIndex++;
    const color = PIN_COLORS[(index - 1) % PIN_COLORS.length];
    pinned.indexLabel.textContent = String(index);
    pinned.indexLabel.style.display = '';
    pinned.indexLabel.style.backgroundColor = color;
    pinned.root.style.borderColor = color;

    pinned.setValue(String(cell.getValue()));
    document.body.appendChild(pinned.root);
    // Appear exactly where the transient tooltip already sits — pinning is
    // a promotion of the thing under the cursor, so it must not jump. (We
    // deliberately don't re-run positionTooltip from the pointer here: that
    // recomputed a fresh pointer+offset location and made the box jump.)
    const tRect = transient.root.getBoundingClientRect();
    pinned.root.style.left = tRect.left + 'px';
    pinned.root.style.top = tRect.top + 'px';
    pinned.root.style.right = 'auto';
    pinned.root.style.bottom = 'auto';

    const pin: Pin = {el: pinned, index, color, row: cell.getRow(), field: cell.getField()};
    pins.push(pin);
    pinned.closeBtn.addEventListener('click', () => removePin(pin));

    hideTransient();
    decorate();
    notifyRendered(); // re-highlight search term inside the new pinned tooltip
  }

  // Keep the transient tooltip alive while the pointer is over it. Also kill
  // any pending show-timer armed by a cell crossed en route, so the content
  // stays frozen on the shown cell instead of swapping under the cursor.
  transient.root.addEventListener('mouseenter', () => { cancelHide(); clearShowTimer(); });
  transient.root.addEventListener('mouseleave', scheduleHide);
  transient.pinBtn.addEventListener('click', pinCurrent);
  // Close button is meaningful only on pinned tooltips; the transient one
  // hides itself on mouse-out, so hide its close button.
  transient.closeBtn.style.display = 'none';

  // Re-decorate whenever Tabulator (re)renders rows.
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
    // A pinned cell already has its own persistent tooltip — don't pop a
    // transient one on top of it.
    if (isPinned(cell)) {
      clearShowTimer();
      hideTransient();
      return;
    }
    cancelHide();
    clearShowTimer();
    // Always re-arm the show delay on every cell enter. Moving directly
    // between fields restarts the timer instead of instantly swapping
    // content (which blinks). The currently-visible tooltip (if any) stays
    // put until the timer fires and swaps to the new cell.
    showTimer = window.setTimeout(() => updateTransient(cell), SHOW_DELAY);
  }

  // Track the pointer while over a cell so the tooltip appears where the
  // cursor actually is when the show-delay fires (not where it entered).
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

/** Shows the menu `menuId` at `anchor` for `context`, as `WidgetContext.showMenu` does for a widget. */
export type ShowTableMenu = (menuId: string, anchor: MenuAnchor, context: object) => void;

/** What the menu `table/cell` is shown for: a cell, by its column's name and its value. */
export interface TableCellMenuContext {
  readonly column: string;
  readonly value: unknown;
  /** Whether the column holds timestamps (a time type, or named `timestamp`). */
  readonly timestamp: boolean;
  /** Whether a click on a cell offers to filter by its value or exclude it (the quick pick "Filter"). */
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

// A column's title with its menu button, which shows `table/header` for it (a click on it does not sort)
function headerTitle(title: string, column: ColumnComponent, showMenu: ShowTableMenu): HTMLElement {
  const size = (c: ColumnComponent) => c.setWidth(calculateSizeOfColumn(c.getTable().getRows('visible'), c.getField()));
  const context: TableHeaderMenuContext = {
    column: column.getField(),
    autoSize: () => size(column),
    autoSizeAll: () => column.getTable().getColumns().forEach(size),
  };
  const button: HTMLButtonElement = html`<button type="button" class="d-table__header-menu" title="Column menu" aria-label=${`Menu of ${title}`} aria-haspopup="dialog"
    onclick=${(event: MouseEvent) => {
      event.stopPropagation();
      showMenu('table/header', button, context);
    }}>⋮</button>`;
  return html`<span class="d-table__header-title">${title}${button}</span>`;
}

/**
 * The rows of `queryResult` as a table (Tabulator) below `props.title`: a search box, filters per column, sticky
 * tooltips that can be pinned. With `selectRecords`, a checkbox in front of each row (and one for all) ticks it, each
 * change calling `selectRecords` with the ticked rows. With `offerFilters`, a click on a cell of a column in
 * `props.categories` offers its value, its column's name the field id; a NULL offers nothing, and a Map, Array or
 * Tuple column (Arrow's map, list, struct) holds no category. With `showMenu`, a right click on a cell shows the menu
 * `table/cell` (a `TableCellMenuContext`), a column header's menu button the menu `table/header` (a
 * `TableHeaderMenuContext`); extensions add their entries there (the `table` extension: SQL filters, auto-size).
 */
export function drawTable(
  queryResult: QueryResult,
  props: TableProps,
  { offerFilters, selectRecords, showMenu }: { offerFilters?: WidgetContext['offerFilters']; selectRecords?: WidgetContext['selectRecords']; showMenu?: ShowTableMenu } = {},
) {

  // Convert Apache Arrow Table to plain JavaScript objects for Tabulator
  const data = queryResult.toArray().map((row: any) => row.toJSON());

  // The search: each change calls applySearch
  let searchTerm = '';

  // With `offerFilters`, a click on a cell of a category column offers its value (see the cellClick handler below)
  const filtering = offerFilters !== undefined;
  const categories = new Set(
    (queryResult?.schema?.fields ?? [])
      .filter((field: any) => props.categories?.includes(field.name))
      .filter((field: any) => !DataType.isMap(field) && !DataType.isList(field) && !DataType.isFixedSizeList(field) && !DataType.isStruct(field))
      .map((field: any) => field.name as string),
  );
  const filterable = (fieldName: string) => filtering && categories.has(fieldName);

  // Build columns with timestamp formatting
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
          // ClickHouse DateTime is in seconds, JS Date expects milliseconds
          // If value is a small number (< 10 billion), it's likely in seconds
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
          const el = document.createElement('div');
          el.innerHTML = `${time} &nbsp; <span class="d-table__date">${date}</span>`;
          return el;
        },
        cssClass: filterable(field.name) ? 'd-table__filterable' : undefined,
      });
    } else {
      columns.push({
        title: field.name,
        field: field.name,
        cssClass: filterable(field.name) ? 'd-table__filterable' : undefined,
      });
    }
  });

  // Create container structure
  const container = document.createElement('div');
  container.classList.add('d-table');

  // Create search input
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search records...';
  searchInput.classList.add('d-field', 'd-field--full', 'd-table__search');
  searchInput.addEventListener('input', (e) => {
    searchTerm = (e.target as HTMLInputElement).value;
    applySearch();
  });

  // Filters the rows by the search term
  let tabulatorTable: Tabulator;
  function applySearch() {
    const needle = searchTerm.toLowerCase();

    if (!needle) {
      // false: the header filters stay
      tabulatorTable.clearFilter(false);
      return;
    }

    // Custom filter function that searches all columns
    tabulatorTable.setFilter((rowData: any) => {
      const searchableText = Object.values(rowData)
        .map(v => String(v).toLowerCase())
        .join(' ');
      return searchableText.includes(needle);
    });
  }

  // Create table element
  const tableRoot = document.createElement('div');
  tableRoot.classList.add("d-table__grid");

  // Highlight the search term everywhere it appears in the widget: visible
  // table cells and the sticky tooltips. Uses the
  // CSS Custom Highlight API — we paint style ranges rather than wrapping
  // matches in <mark>: no DOM mutation means it can't corrupt cells with
  // custom markup (timestamp innerHTML, pin badges) and it survives Tabulator
  // recycling row DOM on scroll/sort/filter. A single named highlight spans
  // all roots. Re-run on table render and on tooltip show/pin (see call
  // sites). Gracefully no-ops where unsupported —
  // filtering still works.
  function applySearchHighlight(term: string) {
    const highlights = (CSS as any).highlights;
    if (!highlights) return;
    highlights.delete('tableSearch');
    const needle = term.trim().toLowerCase();
    if (!needle) return;
    const roots = [
      tableRoot.querySelector('.tabulator-tableholder'),
      // All live tooltips (transient + every pin) — they append to <body>,
      // so query them fresh each run rather than plumbing refs.
      ...document.querySelectorAll('.d-sticky-tooltip'),
    ].filter((el): el is Element => !!el);
    const ranges: Range[] = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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

  tabulatorTable = new Tabulator(tableRoot, {
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
      headerFilter: false // No filter in the checkbox column
    } : undefined,
    columnDefaults: {
      headerFilter: "input", // Add filter input to all column headers
      headerFilterPlaceholder: "Filter...",
      tooltip: false, // replaced by custom sticky tooltip (see cellMouseEnter below)
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
    if (!offerFilters || !filterable(fieldName) || value === null || value === undefined) return;
    offerFilters(cell.getElement(), [{ fieldId: fieldName, value: String(value) }]);
  });

  // Re-paint search highlights after every (re)render — covers filter changes,
  // sorting, and virtual-scroll row recycling.
  tabulatorTable.on("renderComplete", () => applySearchHighlight(searchTerm));

  // Custom sticky tooltip: hover a cell to show its full value; the pointer
  // can move onto the tooltip to select/copy, pin it (marks the source cell
  // [1]/[2]/… + highlights the row), or drag it around.
  //
  // Markup vs. behaviour — what fits here:
  //   - Static skeleton is built with htl `html` (see createTooltipEl).
  //     That's the house style in this file for one-shot DOM.
  //   - Behaviour (drag, viewport-clamped positioning, N independent pins,
  //     live re-decoration on Tabulator renders) is imperative.
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

  // Assemble container
  container.appendChild(searchInput);
  container.appendChild(tableRoot);

  return container;
}