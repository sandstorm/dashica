```js
import hljs from 'npm:highlight.js';
import {chart, clickhouse, component} from '/dashica/index.js';
import * as Inputs from "@observablehq/inputs";

const filters = view(component.globalFilter());
const viewOptions = view(component.viewOptions());
```

# autoTable

The autoTable component displays query results as an interactive, searchable table with support for selecting rows and viewing detailed record information.

The `autoTable` component is ideal for:
- Displaying log entries and detailed records
- Browsing through query results with search functionality
- Inspecting individual records in detail
- Creating interactive data exploration interfaces

## Data Requirements

**When to use?** Use autoTable when you want to display tabular data (any SQL query result) with built-in search and detail viewing capabilities.

Your SQL query can return any column types:
- **Text/String**: Displayed as text, searchable
- **Numeric**: Integer, Float, or other numeric types
- **Timestamp/DateTime**: Automatically formatted with date and time
- **JSON**: Automatically formatted and pretty-printed

## Minimal Example: Basic Table

The minimal usage requires:
- A SQL query that returns data
- The `autoTable` component to display it

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("10_queries/requests_by_status.sql").text(), {language: 'sql'}).value;
display(n);
```

```js
const tableData = await clickhouse.query(
    '/src/docs/10_queries/requests_by_status.sql',
    {filters}
);
```

```js echo
// Create a search input for filtering the data
const tableDataFiltered = view(Inputs.search(tableData, {placeholder: "Search records"}));
```

```js echo
// Display the table with selected rows
const tableDataSelected = view(component.autoTable(
    tableData,           // Original data for schema detection
    tableDataFiltered,   // Filtered data to display
    {
        rows: 10,        // Number of rows to show per page
        required: false  // Allow zero rows selected
    }
));
```

```js echo
// Display details of selected rows
display(component.recordDetails(tableDataSelected));
```

## Combined Example: All-in-One

**We recommend using the `autoTableCombined` function for all-in-one components.**

The `autoTableCombined` function provides search, table, and record details in a single component:

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("10_queries/requests_by_status_and_host_name.sql").text(), {language: 'sql'}).value;
display(n);
```

```js echo
component.autoTableCombined(
    await clickhouse.query(
        '/src/docs/10_queries/requests_by_status_and_host_name.sql',
        {filters}
    ),
    {
        rows: 15,        // Number of rows per page
        required: false  // Allow zero rows selected
    },
    invalidation
)
```

## Features

### Automatic Timestamp Formatting

Timestamp columns are automatically detected and formatted with time and date. The format is:
- **Time**: HH:MM:SS (24-hour format)
- **Date**: DD/MM/YY

### Double-Click to Filter

Double-clicking any cell in the table automatically adds a filter for that field and value to the global filter. This makes it easy to drill down into specific data.

### JSON Formatting

If a cell value starts with `{` and is valid JSON, it will be automatically parsed and pretty-printed in the record details view.

### Multi-line Values

Values containing newlines are automatically displayed in a `<pre>` tag for better readability in the record details view.

## Configuration Options for `autoTable`

The `autoTable` function accepts three parameters:

```
component.autoTable(origDataForSchema, data, options)
```

**Parameters:**
- `origDataForSchema`: The original query result (used for schema detection, e.g., to detect timestamp columns)
- `data`: The data to display (can be filtered/searched data)
- `options`: Configuration object

**Options:**
- `rows`: Number of rows to display per page (default: depends on Observable Inputs.table)
- `required`: Boolean - whether selection is required (default: true)
- `format`: Object mapping column names to formatter functions
- `width`: Object mapping column names to width strings (e.g., `{columnName: '150px'}`)
- Any other options supported by [Observable Inputs.table](https://github.com/observablehq/inputs?tab=readme-ov-file#table)

## Configuration Options for `autoTableCombined`

The `autoTableCombined` function combines search, table, and record details:

```
component.autoTableCombined(queryResult, options, invalidation)
```

**Parameters:**
- `queryResult`: The query result from `clickhouse.query()`
- `options`: Configuration object (same as `autoTable`)
- `invalidation`: The invalidation promise (pass through from page context)

## Custom Formatting Example

You can provide custom formatters for specific columns:

```
const data = await clickhouse.query('/path/to/query.sql', {filters});
const filtered = view(Inputs.search(data, {placeholder: "Search"}));

const selected = view(component.autoTable(
    data,
    filtered,
    {
        rows: 20,
        format: {
            // Custom formatter for a specific column
            status: (value) => value === 200 ? '✓ OK' : '✗ Error',
            count: (value) => value.toLocaleString()
        },
        width: {
            status: '80px',
            timestamp: '150px'
        }
    }
));
```

## Working with recordDetails

The `recordDetails` component displays selected table rows in a detailed key-value format:

```js
const selectedRows = view(component.autoTable(data, filteredData, options));
display(component.recordDetails(selectedRows));
```

The record details component:
- Shows each field as a key-value pair
- Automatically detects and pretty-prints JSON values
- Displays multi-line values in `<pre>` tags
- Uses a monospace font for better readability

## Reference for `autoTable`

**Function: `component.autoTable(origDataForSchema, data, options)`**

Creates an interactive table component with row selection.

**Parameters:**
- `origDataForSchema` (QueryResult): Original data for schema detection
- `data` (Array): The data to display (can be filtered)
- `options` (Object): Configuration options

**Options:**
- `rows` (Number): Number of rows per page
- `required` (Boolean): Whether row selection is required
- `format` (Object): Column name to formatter function mapping
- `width` (Object): Column name to width string mapping
- Additional options from [Observable Inputs.table](https://github.com/observablehq/inputs?tab=readme-ov-file#table)

**Function: `component.autoTableCombined(queryResult, options, invalidation)`**

Creates a combined component with search, table, and record details.

**Parameters:**
- `queryResult` (QueryResult): Query result from clickhouse.query()
- `options` (Object): Same as autoTable options
- `invalidation` (Promise): Invalidation promise for reactivity

**Function: `component.recordDetails(records)`**

Displays selected records in a detailed key-value format.

**Parameters:**
- `records` (Array): Array of selected record objects

**Common Patterns:**

Pattern 1: Separate components with search

```
const data = await clickhouse.query('/path/to/query.sql', {filters});
const filtered = view(Inputs.search(data, {placeholder: "Search"}));
const selected = view(component.autoTable(data, filtered, {rows: 20}));
display(component.recordDetails(selected));
```

Pattern 2: All-in-one combined component **recommended**

```
display(component.autoTableCombined(
    await clickhouse.query('/path/to/query.sql', {filters}),
    {rows: 20},
    invalidation
));
```
