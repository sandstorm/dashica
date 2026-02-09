import {html} from "htl";
import {DataType, Field} from "apache-arrow";
import {TabulatorFull as Tabulator} from 'tabulator-tables';
import type {ColumnDefinition, RowComponent, CellComponent} from 'tabulator-tables';
import Alpine from '@alpinejs/csp';

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

            // Handle JSON objects
            if (valueStr.trim().startsWith('{')) {
                try {
                    const formatted = JSON.stringify(JSON.parse(valueStr), null, "  ");
                    return `
                        <p class="font-mono">
                            <span class="font-bold">${key}</span>:
                            <span class="break-all"><pre>${formatted}</pre></span>
                        </p>
                    `;
                } catch (e) {
                    // If parsing fails, handle as regular value
                }
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

export function table(queryResult: any, extProps: any) {
    console.log("AUTOTABLE2", {queryResult, extProps});
    const props = Object.assign({}, extProps);
    props.format = props.format || {};
    props.width = props.width || {};

    // Convert Apache Arrow Table to plain JavaScript objects for Tabulator
    const data = queryResult.toArray().map((row: any) => row.toJSON());

    // Create reactive state for search and selection
    const state = Alpine.reactive({
        searchTerm: '',
        selectedRecords: [] as Record<string, any>[],
        detailsHtml: ''
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
                const start = new Date(dt.getTime() - 5 * 60 * 1000);
                const end = new Date(dt.getTime() + 5 * 60 * 1000);
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${fieldName} BETWEEN '${start.toISOString()}' AND '${end.toISOString()}'`
                }));
            }
        },
        {
            label: "Filter: Time ±1 hour",
            action: function(e: any, cell: CellComponent) {
                const value = cell.getValue();
                const dt = new Date(value);
                const start = new Date(dt.getTime() - 60 * 60 * 1000);
                const end = new Date(dt.getTime() + 60 * 60 * 1000);
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${fieldName} BETWEEN '${start.toISOString()}' AND '${end.toISOString()}'`
                }));
            }
        },
        {
            label: "Filter: Time ±24 hours",
            action: function(e: any, cell: CellComponent) {
                const value = cell.getValue();
                const dt = new Date(value);
                const start = new Date(dt.getTime() - 24 * 60 * 60 * 1000);
                const end = new Date(dt.getTime() + 24 * 60 * 60 * 1000);
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${fieldName} BETWEEN '${start.toISOString()}' AND '${end.toISOString()}'`
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
        if (DataType.isTimestamp(field)) {
            columns.push({
                title: field.name,
                field: field.name,
                formatter: (cell: CellComponent) => {
                    const value = cell.getValue();
                    const dt = new Date(value);
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
            hozAlign: "center"
        },
        columnDefaults: {
            tooltip: function(e, cell, onRendered) {
                if (!cell.getValue()) {
                    return "";
                }
                return html`<div class="tabulatorTable__tooltip"><code>${cell.getValue()}</code></div>`;
            },
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

    // Create record details panel
    const detailsPanel = document.createElement('div');
    detailsPanel.classList.add('record-details-panel');
    detailsPanel.style.display = 'none';

    const detailsContainer = document.createElement('div');
    detailsContainer.classList.add('recordDetails');

    detailsPanel.appendChild(detailsContainer);

    // Auto-update panel visibility and content
    Alpine.effect(() => {
        if (state.selectedRecords.length > 0) {
            detailsPanel.style.display = 'block';
            detailsContainer.innerHTML = state.detailsHtml;
        } else {
            detailsPanel.style.display = 'none';
        }
    });

    // Assemble container
    container.appendChild(searchInput);
    container.appendChild(tableRoot);
    container.appendChild(detailsPanel);

    return container;
}