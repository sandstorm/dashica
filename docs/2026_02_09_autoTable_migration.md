# AutoTable Migration Plan: Enhance table.ts with Legacy Features

## Context

The new Tabulator-based table implementation (`frontend/chart/table.ts`) provides excellent features like column reordering, auto-sizing, and tooltips, but lacks critical data exploration capabilities from the legacy Observable-based implementation (`npm/dashica/src/component/autoTable.ts`). Users need:

1. **Interactive filtering**: Context menu (right-click) on cells to add SQL filter conditions
2. **Fulltext search**: Search across all table records (works with Apache Arrow tables or plain objects)
3. **Record inspection**: View detailed information for selected rows
4. **Timestamp filtering**: Context menu on timestamp cells for time-based filtering (context ±X time)
5. **Multi-record comparison**: Display multiple selected records side-by-side for comparison

The goal is to enhance table.ts to match autoTable.ts functionality while preserving Tabulator's advanced features.

## Recommended Approach: Bottom Panel with Card Layout

Based on user requirements for comparing multiple records side-by-side while keeping the application usable, we'll implement a **bottom panel** that:

- Displays selected records in a horizontal card layout (existing recordDetails pattern)
- Slides up from bottom using DaisyUI drawer component
- Shows multiple records simultaneously for comparison
- Remains non-intrusive when no rows are selected
- Integrates with Tabulator's row selection system

## Implementation Steps

### Step 1: Enable Timestamp Field Formatting

**File**: `frontend/chart/table.ts` (lines 69-89)

**Action**: Uncomment and adapt the timestamp formatting code for Tabulator

**Changes needed**:
- Uncomment the timestamp detection and formatting block
- Replace Observable's `html` with Tabulator's `formatter` function pattern
- Use Tabulator's `formatter` property in column definition
- Format as `HH:MM:SS  DD/MM/YY` with visual styling

**Tabulator formatter signature**:
```typescript
formatter: (cell: CellComponent) => string | HTMLElement
```

**Example implementation**:
```typescript
if (DataType.isTimestamp(field)) {
    columns.push({
        title: field.name,
        field: field.name,
        formatter: (cell) => {
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
            el.innerHTML = `${time} <span class="autoTable__timestampDate">${date}</span>`;
            return el;
        }
    });
}
```

### Step 2: Implement Context Menu for Cell Filtering

**File**: `frontend/chart/table.ts`

**Action**: Add context menu to all cells for interactive filtering

**Implementation approach**:
- Use Tabulator's `contextMenu` property in `columnDefaults`
- Create menu items for common filter operations
- Extract field name and value from cell
- Dispatch `dashica-add-filter` CustomEvent with proper filter string format

**Tabulator context menu pattern** (Reference: [Tabulator Menus](https://tabulator.info/docs/6.3/menu)):
```typescript
columnDefaults: {
    contextMenu: [
        {
            label: "Filter: Equals this value",
            action: function(e, cell) {
                const field = cell.getColumn().getField();
                const value = cell.getValue();
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${field} = '${value}'`
                }));
            }
        },
        {
            label: "Filter: Not equals this value",
            action: function(e, cell) {
                const field = cell.getColumn().getField();
                const value = cell.getValue();
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${field} != '${value}'`
                }));
            }
        },
        {
            label: "Filter: Contains this value",
            action: function(e, cell) {
                const field = cell.getColumn().getField();
                const value = cell.getValue();
                window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                    detail: `${field} LIKE '%${value}%'`
                }));
            }
        }
    ]
}
```

**For timestamp fields**, add specialized context menu:
```typescript
contextMenu: [
    {
        label: "Filter: Time ±5 minutes",
        action: function(e, cell) {
            const field = cell.getColumn().getField();
            const value = cell.getValue();
            const dt = new Date(value);
            const start = new Date(dt.getTime() - 5 * 60 * 1000);
            const end = new Date(dt.getTime() + 5 * 60 * 1000);
            window.dispatchEvent(new CustomEvent('dashica-add-filter', {
                detail: `${field} BETWEEN '${start.toISOString()}' AND '${end.toISOString()}'`
            }));
        }
    },
    {
        label: "Filter: Time ±1 hour",
        action: function(e, cell) {
            // Similar implementation with ±1 hour
        }
    }
]
```

### Step 3: Implement Reactive Row Selection State

**File**: `frontend/chart/table.ts`

**Action**: Track selected rows internally using Alpine.js reactivity to update the record details panel

**Implementation approach**:
- Create reactive state using `Alpine.reactive()` to store selected row data
- Use `Alpine.effect()` to automatically update UI when selection changes
- Listen to Tabulator's `rowSelectionChanged` event to update the reactive state
- No need to expose selection externally via `.value` property

**Implementation pattern**:
```typescript
const state = Alpine.reactive({
    selectedRecords: []
});

table.on("rowSelectionChanged", (data, rows) => {
    state.selectedRecords = data; // Auto-triggers Alpine.effect callbacks
});
```

**Note**: Tabulator provides `table.getSelectedData()` and `table.getSelectedRows()` methods for retrieving selection

### Step 4: Integrate recordDetails Rendering into Table Component

**File**: `frontend/chart/table.ts`

**Action**: Add recordDetails rendering logic directly within the table component (no separate file needed)

**Source Reference**: `/home/sebastian/dashica/npm/dashica/src/component/recordDetails.ts` (lines 4-54)

**Implementation approach**:
- Build recordDetails rendering function using **Alpine.js** (not vanilla DOM)
- Remove Observable/htl dependencies from the original implementation
- Keep the JSON formatting logic and field rendering
- Maintain the card-based flexbox layout with CSS classes
- Use `Alpine.effect()` to automatically re-render when `state.selectedRecords` changes

**Rendering pattern**:
```typescript
function renderRecordDetails(records) {
    if (!records.length) return '';

    return records.map(record => `
        <div class="recordDetails__record">
            ${Object.entries(record).map(([key, value]) => `
                <div class="recordDetails__field">
                    <div class="recordDetails__fieldName">${key}</div>
                    <div class="recordDetails__fieldValue">${formatValue(value)}</div>
                </div>
            `).join('')}
        </div>
    `).join('');
}
```

**CSS**: Port styles from `npm/dashica/style.css` (lines 108-134) to the current CSS setup:
- `.recordDetails` - flex container
- `.recordDetails__record` - card styling
- `.recordDetails__field` - field layout

### Step 5: Implement Bottom Panel with RecordDetails

**File**: `frontend/chart/table.ts`

**Action**: Wrap table in a container with a simple bottom panel for record details

**Implementation approach** (simpler, no DaisyUI drawer):

1. Create container structure with bottom panel:
```html
<div class="table-with-details">
    <div class="tabulator-container">
        {table element}
    </div>
    <div class="record-details-panel"
         x-data="tableRecordDetails"
         x-show="selectedRecords.length > 0"
         x-transition>
        <div class="recordDetails" x-html="detailsHtml">
            <!-- recordDetails rendered here -->
        </div>
    </div>
</div>
```

2. Use **Alpine.reactive()** and **Alpine.effect()** for state management:
```typescript
const state = Alpine.reactive({
    selectedRecords: [],
    detailsHtml: ''
});

// Auto-update HTML when selection changes
Alpine.effect(() => {
    state.detailsHtml = renderRecordDetails(state.selectedRecords);
});

// Listen to Tabulator's rowSelectionChanged event
table.on("rowSelectionChanged", (data, rows) => {
    state.selectedRecords = data; // Triggers Alpine.effect automatically
});
```

3. Add CSS for bottom panel:
```css
.record-details-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 40vh;
    overflow-y: auto;
    background: white;
    border-top: 1px solid #ddd;
    box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
}
```

**Benefits**:
- Simpler than DaisyUI drawer (which doesn't support bottom positioning well)
- CSS transitions provide smooth slide-up effect
- Alpine.js handles all reactivity automatically


### Step 6: Add Fulltext Search

**File**: `frontend/chart/table.ts`

**Action**: Add fulltext search input above table that works with both Apache Arrow tables and plain objects

**Implementation approach**:

1. **Data handling clarification**: The `table()` function receives:
   - `origDataForSchema`: Apache Arrow Table (for schema metadata)
   - `data`: The original data source, which can be:
     - Apache Arrow Table (needs conversion to plain objects)
     - Plain JavaScript objects array (use directly)
   - We need to handle both cases when implementing search

2. **Search implementation using Alpine.reactive()**:

```typescript
const state = Alpine.reactive({
    searchTerm: ''
});

// Create search container
const container = document.createElement('div');
container.classList.add('table-container');

// Add search input with Alpine binding
const searchInput = document.createElement('input');
searchInput.setAttribute('x-model', 'searchTerm');
searchInput.setAttribute('x-on:input', 'handleSearch');
searchInput.type = 'text';
searchInput.placeholder = 'Search records...';
searchInput.classList.add('input', 'input-bordered', 'w-full', 'mb-2');

// Auto-update filter when search term changes
Alpine.effect(() => {
    const searchTerm = state.searchTerm.toLowerCase();

    if (!searchTerm) {
        table.clearFilter();
        return;
    }

    // Custom filter function that searches all columns
    table.setFilter([
        (data, filterParams) => {
            // Search across all field values
            const searchableText = Object.values(data)
                .map(v => String(v).toLowerCase())
                .join(' ');
            return searchableText.includes(filterParams.searchTerm);
        }
    ], {searchTerm});
});

container.appendChild(searchInput);
container.appendChild(root); // root is the table element
return container;
```

**Note on Tabulator's built-in header filters**:
- Tabulator's `headerFilter: true` provides per-column filtering with a search icon in each column header
- This is great for **column-specific** filtering but does **NOT** work for fulltext search across all records
- For fulltext search that searches across all columns simultaneously, we need the custom implementation above
- Both approaches can coexist: header filters for column-specific search + global search input for fulltext search


## Critical Files

### Files to Modify
1. **`frontend/chart/table.ts`** - Main implementation file
   - Enable timestamp formatting (lines 69-89)
   - Add context menu for filtering (including timestamp time-range filters)
   - Add fulltext search input with Alpine.reactive state
   - Implement reactive row selection tracking (Alpine.reactive + Alpine.effect)
   - Integrate recordDetails rendering and bottom panel display
   - All recordDetails logic stays within this file (no separate component file needed)

2. **Frontend CSS file** - Add recordDetails styles
   - Port `.recordDetails`, `.recordDetails__record`, `.recordDetails__field` styles from npm/dashica/style.css
   - Add `.record-details-panel` styles for bottom panel


### Files to Reference
1. **`npm/dashica/src/component/autoTable.ts`** - Feature reference
2. **`npm/dashica/src/component/recordDetails.ts`** - Component to port
3. **`npm/dashica/style.css`** (lines 108-134) - RecordDetails CSS
4. **`frontend/components/debugDrawer.ts`** - Drawer pattern example
5. **`npm/dashica/src/component/sqlFilterInput.ts`** - Filter event listener

## Existing Patterns to Reuse

1. **Event System**: `dashica-add-filter` CustomEvent (window-level)
2. **CSS Classes**: `.recordDetails`, `.recordDetails__record` (already styled in npm/dashica/style.css)
3. **Alpine.js Reactivity**:
   - `Alpine.reactive()` for creating reactive state objects
   - `Alpine.effect()` for automatic side effects when reactive state changes
   - State changes automatically trigger UI updates without manual event handling

## Technical Considerations

### Apache Arrow Schema Access
- `origDataForSchema?.schema?.fields` provides Field objects
- Use `DataType.isTimestamp(field)` to detect timestamp columns
- Each field has `.name` property for column identification

### Tabulator API Methods
- `table.getSelectedData()` - Get array of selected row data objects
- `table.getSelectedRows()` - Get RowComponent objects
- `table.on("rowSelectionChanged", callback)` - Selection event
- `table.setFilter()` - Programmatic filtering

## Verification Plan

### Manual E2E Testing

1. **Timestamp Formatting**:
   - Load a query with timestamp fields
   - Verify timestamps display as `HH:MM:SS  DD/MM/YY` format
   - Check the date has lighter styling

2. **Context Menu Filtering**:
   - Right-click a cell value
   - Verify context menu appears with filter options
   - Select "Filter: Equals this value"
   - Verify filter appears in SQL filter input (top of page)
   - Verify query re-executes with `AND field = 'value'` condition
   - Verify table updates with filtered results
   - Test "Not equals" and "Contains" options

3. **Timestamp Context Menu**:
   - Right-click a timestamp cell
   - Verify context menu shows time-based filter options (±5 min, ±1 hour)
   - Select a time range option
   - Verify BETWEEN filter added to SQL input
   - Verify table updates with time-filtered results

4. **Record Details Display**:
   - Select one or more rows using row header checkboxes
   - Verify bottom panel slides up showing selected records
   - Verify each record displays as a card with all fields
   - Verify JSON fields are pretty-printed
   - Verify multiple records display side-by-side
   - Deselect rows and verify panel closes

5. **Multi-Record Comparison**:
   - Select 3-4 rows
   - Verify all selected records visible simultaneously
   - Verify can still interact with table while details are shown
   - Verify can scroll details panel independently

6. **Fulltext Search**:
   - Type in search input
   - Verify table filters in real-time
   - Verify search works across all columns


### Browser Testing

Run the application:
```bash
mise r watch
```

Navigate to a dashboard with table widgets and test all scenarios above.
