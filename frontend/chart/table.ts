import {html} from "htl";
import {DataType, Field} from "apache-arrow";
import {TabulatorFull as Tabulator} from 'tabulator-tables';
import type {ColumnDefinition, RowComponent, CellComponent} from 'tabulator-tables';
import Alpine from '@alpinejs/csp';
import {Maximize2, X, Pin, Copy, Braces, createElement} from 'lucide';
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

// Render record details as HTML string
function renderRecordDetails(records: Record<string, any>[]): string {
    if (!records.length) return '';

    return records.map(record => {
        const fields = Object.entries(record).map(([key, value]) => {
            const valueStr = String(value);

            // Handle JSON objects/arrays
            const formatted = tryPrettyJson(valueStr);
            if (formatted !== null) {
                return `
                    <p class="font-mono">
                        <span class="font-bold">${key}</span>:
                        <span class="break-all"><pre>${formatted}</pre></span>
                    </p>
                `;
            }

            // Handle multiline values
            if (valueStr.trim().includes('\n')) {
                return `
                    <p class="font-mono">
                        <span class="font-bold">${key}</span>:
                        <span class="break-all"><pre>${valueStr}</pre></span>
                    </p>
                `;
            }

            // Regular values
            return `
                <p class="font-mono">
                    <span class="font-bold">${key}</span>:
                    <span class="break-all">${valueStr}</span>
                </p>
            `;
        }).join('');

        return `<div class="recordDetails__record">${fields}</div>`;
    }).join('');
}

// Try to detect + pretty-print JSON. Returns null if the string is not JSON.
function tryPrettyJson(raw: string): string | null {
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
    // Build the static skeleton with htl (same pattern as `panelHeader` below);
    // grab element refs afterwards. Behaviour (drag/position/pin) is wired
    // imperatively — see the note in `table()` on why Alpine don't fit.
    const root = html`<div class="stickyTooltip">
        <div class="stickyTooltip__header">
            <span class="stickyTooltip__index" style="display:none"></span>
            <button class="stickyTooltip__btn stickyTooltip__json" title="Toggle JSON pretty-print">${createElement(Braces)}</button>
            <button class="stickyTooltip__btn stickyTooltip__copy" title="Copy to clipboard">${createElement(Copy)}</button>
            <span class="stickyTooltip__spacer"></span>
            <button class="stickyTooltip__btn stickyTooltip__pin" title="Pin (keeps this open + marks the source; drag header to move)">${createElement(Pin)}</button>
            <button class="stickyTooltip__btn stickyTooltip__close" title="Close">${createElement(X)}</button>
        </div>
        <pre class="stickyTooltip__body"><code></code></pre>
    </div>` as HTMLElement;

    const header = root.querySelector('.stickyTooltip__header') as HTMLElement;
    const indexLabel = root.querySelector('.stickyTooltip__index') as HTMLElement;
    const jsonBtn = root.querySelector('.stickyTooltip__json') as HTMLButtonElement;
    const copyBtn = root.querySelector('.stickyTooltip__copy') as HTMLButtonElement;
    const pinBtn = root.querySelector('.stickyTooltip__pin') as HTMLButtonElement;
    const closeBtn = root.querySelector('.stickyTooltip__close') as HTMLButtonElement;
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
            copyBtn.classList.add('stickyTooltip__btn--ok');
            window.setTimeout(() => copyBtn.classList.remove('stickyTooltip__btn--ok'), 800);
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
        if (!root.classList.contains('stickyTooltip--pinned')) {
            return;
        }
        if ((e.target as HTMLElement).closest('.stickyTooltip__btn')) {
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
function createTooltipManager(table: Tabulator) {
    const transient = createTooltipEl();
    transient.root.classList.add('stickyTooltip--transient');
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
    }

    // Re-apply source markers + row highlights for all pins. Runs on every
    // render, so it first strips stale decoration then re-adds it for whichever
    // pinned rows are currently rendered.
    function decorate() {
        const tableEl = (table as any).element as HTMLElement | undefined;
        if (!tableEl) return;
        tableEl.querySelectorAll('.stickyTooltip__badge').forEach(n => n.remove());
        tableEl.querySelectorAll('.stickyTooltip__pinnedRow').forEach(n => {
            const row = n as HTMLElement;
            row.classList.remove('stickyTooltip__pinnedRow');
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
                rowEl.classList.add('stickyTooltip__pinnedRow');
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
            if (cellEl && !cellEl.querySelector('.stickyTooltip__badge')) {
                const badge = document.createElement('span');
                badge.className = 'stickyTooltip__badge';
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
        pinned.root.classList.add('stickyTooltip--pinned');
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

export function table(queryResult: any, extProps: any) {
    const props = Object.assign({}, extProps);
    props.format = props.format || {};
    props.width = props.width || {};

    // Convert Apache Arrow Table to plain JavaScript objects for Tabulator
    const data = queryResult.toArray().map((row: any) => row.toJSON());

    // Create reactive state for search and selection
    const state = Alpine.reactive({
        searchTerm: '',
        selectedRecords: [] as Record<string, any>[],
        detailsHtml: '',
        panelFullscreen: false
    });

    // Auto-update details HTML when selection changes
    Alpine.effect(() => {
        state.detailsHtml = renderRecordDetails(state.selectedRecords);
    });

    // Build timestamp-specific context menu
    const timestampContextMenu = (fieldName: string) => [
        {
            label: "Filter: Equals this timestamp",
            action: function(e: any, cell: CellComponent) {
                const value = cell.getValue();
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${fieldName} = '${value}'`
                }));
            }
        },
        {
            label: "Filter: Time ±5 minutes",
            action: function(e: any, cell: CellComponent) {
                const value = cell.getValue();
                const dt = new Date(value);
                const startSec = (dt.getTime() - 5 * 60 * 1000) / 1000;
                const endSec = (dt.getTime() + 5 * 60 * 1000) / 1000;
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${fieldName} BETWEEN ${startSec} AND ${endSec}`
                }));
            }
        },
        {
            label: "Filter: Time ±1 hour",
            action: function(e: any, cell: CellComponent) {
                const value = cell.getValue();
                const dt = new Date(value);
                const startSec = (dt.getTime() - 60 * 60 * 1000) / 1000;
                const endSec = (dt.getTime() + 60 * 60 * 1000) / 1000;
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${fieldName} BETWEEN ${startSec} AND ${endSec}`
                }));
            }
        },
        {
            label: "Filter: Time ±24 hours",
            action: function(e: any, cell: CellComponent) {
                const value = cell.getValue();
                const dt = new Date(value);
                const startSec = (dt.getTime() - 24 * 60 * 60 * 1000) / 1000;
                const endSec = (dt.getTime() + 24 * 60 * 60 * 1000) / 1000;
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${fieldName} BETWEEN ${startSec} AND ${endSec}`
                }));
            }
        }
    ];

    // Build general context menu
    const generalContextMenu = (fieldName: string) => [
        {
            label: "Filter: Equals this value",
            action: function(e: any, cell: CellComponent) {
                const value = cell.getValue();
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${fieldName} = '${value}'`
                }));
            }
        },
        {
            label: "Filter: Not equals this value",
            action: function(e: any, cell: CellComponent) {
                const value = cell.getValue();
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${fieldName} != '${value}'`
                }));
            }
        },
        {
            label: "Filter: Contains this value",
            action: function(e: any, cell: CellComponent) {
                const value = cell.getValue();
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${fieldName} LIKE '%${value}%'`
                }));
            }
        }
    ];

    // Build columns with timestamp formatting
    const columns: ColumnDefinition[] = [];
    queryResult?.schema?.fields?.forEach((field: any) => {
        const isTimestamp = DataType.isTimestamp(field) || field.name === 'timestamp';

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
                    el.innerHTML = `${time} &nbsp; <span class="autoTable__timestampDate">${date}</span>`;
                    return el;
                },
                contextMenu: timestampContextMenu(field.name)
            });
        } else {
            columns.push({
                title: field.name,
                field: field.name,
                contextMenu: generalContextMenu(field.name)
            });
        }
    });

    // Create container structure
    const container = document.createElement('div');
    container.classList.add('table-with-details');

    // Render the title, styled like the <h2> Observable Plot generates for
    // the other chart types (and like the loading placeholder in chart.ts).
    if (typeof props.title === 'string' && props.title.length > 0) {
        const title = document.createElement('h2');
        title.textContent = props.title;
        title.style.font = 'bold 14pt sans-serif';
        title.style.margin = '1.5em 0 1em 0';
        container.appendChild(title);
    }

    // Create search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search records...';
    searchInput.classList.add('input', 'input-bordered', 'w-full', 'mb-2');
    searchInput.addEventListener('input', (e) => {
        state.searchTerm = (e.target as HTMLInputElement).value;
    });

    // Auto-update filter when search term changes
    let tabulatorTable: Tabulator;
    Alpine.effect(() => {
        const searchTerm = state.searchTerm.toLowerCase();

        if (!tabulatorTable) return;

        if (!searchTerm) {
            tabulatorTable.clearFilter();
            return;
        }

        // Custom filter function that searches all columns
        tabulatorTable.setFilter((rowData: any) => {
            const searchableText = Object.values(rowData)
                .map(v => String(v).toLowerCase())
                .join(' ');
            return searchableText.includes(searchTerm);
        });
    });

    // Create table element
    const tableRoot = document.createElement('div');
    tableRoot.classList.add("tabulatorTable");

    tabulatorTable = new Tabulator(tableRoot, {
        height: props.height,
        maxHeight: "100vh",
        data: data,
        layout: "fitData",
        columns: columns,
        movableColumns: true,
        rowHeader: {
            formatter: "rowSelection",
            titleFormatter: "rowSelection",
            headerSort: false,
            resizable: false,
            frozen: true,
            headerHozAlign: "center",
            hozAlign: "center",
            headerFilter: false // No filter in the checkbox column
        },
        columnDefaults: {
            headerFilter: "input", // Add filter input to all column headers
            headerFilterPlaceholder: "Filter...",
            tooltip: false, // replaced by custom sticky tooltip (see cellMouseEnter below)
            headerMenu: [
                {
                    label: "Auto-size column (based on visible data)",
                    action: function(e, column) {
                        const visibleRows = column.getTable().getRows("visible");
                        column.setWidth(calculateSizeOfColumn(visibleRows, column.getField()));
                    }
                },
                {
                    label: "Auto-size all columns (based on visible data)",
                    action: function(e, column) {
                        const visibleRows = column.getTable().getRows("visible");
                        column.getTable().getColumns().forEach(c => {
                            c.setWidth(calculateSizeOfColumn(visibleRows, c.getField()));
                        })
                    }
                }
            ]
        }
    });

    // Listen to row selection changes
    tabulatorTable.on("rowSelectionChanged", (data, rows) => {
        state.selectedRecords = data;
    });

    // Custom sticky tooltip: hover a cell to show its full value; the pointer
    // can move onto the tooltip to select/copy, pin it (marks the source cell
    // [1]/[2]/… + highlights the row), or drag it around.
    //
    // Markup vs. behaviour — what fits here:
    //   - Static skeleton is built with htl `html` (see createTooltipEl), the
    //     same approach as `panelHeader` below. That's the house style in this
    //     file for one-shot DOM.
    //   - Behaviour (drag, viewport-clamped positioning, N independent pins,
    //     live re-decoration on Tabulator renders) is imperative. Alpine (we
    //     use @alpinejs/csp — CSP mode forbids inline expressions and wants
    //     registered x-data components) is a poor fit for this transient,
    //     multi-instance, pointer-driven widget; Alpine here stays where it
    //     shines: the reactive search/selection state above.
    const tooltipManager = createTooltipManager(tabulatorTable);
    tabulatorTable.on("cellMouseEnter", (e: any, cell: CellComponent) => {
        tooltipManager.onCellEnter(e, cell);
    });
    tabulatorTable.on("cellMouseMove", (e: any) => {
        tooltipManager.onCellMove(e);
    });
    tabulatorTable.on("cellMouseLeave", () => {
        tooltipManager.onCellLeave();
    });

    // Create record details panel with header
    const detailsPanel = document.createElement('div');
    detailsPanel.classList.add('record-details-panel');

    // Panel header with controls
    const fullscreenIcon = createElement(Maximize2);
    fullscreenIcon.classList.add('w-4', 'h-4');

    const closeIcon = createElement(X);
    closeIcon.classList.add('w-4', 'h-4');

    const panelHeader = html`<div class="record-details-header">
        <div class="flex items-center justify-between p-2 border-b border-base-300 bg-base-200">
            <span class="font-semibold text-sm">
                <span class="selected-count">0</span> record(s) selected
            </span>
            <div class="flex gap-2">
                <button class="btn btn-xs btn-ghost fullscreen-btn" title="Toggle fullscreen">
                    ${fullscreenIcon}
                </button>
                <button class="btn btn-xs btn-ghost close-btn" title="Close">
                    ${closeIcon}
                </button>
            </div>
        </div>
    </div>`;

    const detailsContainer = document.createElement('div');
    detailsContainer.classList.add('recordDetails');

    detailsPanel.appendChild(panelHeader);
    detailsPanel.appendChild(detailsContainer);

    // Setup button handlers
    const fullscreenBtn = panelHeader.querySelector('.fullscreen-btn') as HTMLButtonElement;
    const closeBtn = panelHeader.querySelector('.close-btn') as HTMLButtonElement;
    const selectedCountSpan = panelHeader.querySelector('.selected-count') as HTMLSpanElement;

    fullscreenBtn.addEventListener('click', () => {
        state.panelFullscreen = !state.panelFullscreen;
    });

    closeBtn.addEventListener('click', () => {
        // Deselect all rows
        tabulatorTable.deselectRow();
    });

    // Auto-update panel visibility, content, and fullscreen state
    Alpine.effect(() => {
        const hasSelection = state.selectedRecords.length > 0;

        // Update selected count
        selectedCountSpan.textContent = state.selectedRecords.length.toString();

        // Toggle panel visibility with animation
        if (hasSelection) {
            detailsPanel.classList.remove('hidden');
            // Force reflow to enable CSS transition
            void detailsPanel.offsetHeight;
            detailsPanel.classList.add('open');
            detailsContainer.innerHTML = state.detailsHtml;
        } else {
            detailsPanel.classList.remove('open');
            // Wait for animation before hiding
            setTimeout(() => {
                if (state.selectedRecords.length === 0) {
                    detailsPanel.classList.add('hidden');
                }
            }, 300);
        }

        // Toggle fullscreen class
        if (state.panelFullscreen) {
            detailsPanel.classList.add('fullscreen');
        } else {
            detailsPanel.classList.remove('fullscreen');
        }
    });

    // Assemble container
    container.appendChild(searchInput);
    container.appendChild(tableRoot);
    container.appendChild(detailsPanel);

    return container;
}