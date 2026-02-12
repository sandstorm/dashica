package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func Table() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("Table Widget").
				Content(`
# Table Widget

The Table widget displays SQL query results as an interactive, searchable table with advanced filtering and data exploration capabilities.

**Ideal for:**
- Displaying log entries and detailed records
- Browsing query results with interactive search
- Inspecting individual records in detail
- Creating data exploration interfaces with context-menu filtering

## Interactive Features

The Table widget provides rich interactivity out of the box:

- **Fulltext search** - Search across all columns instantly
- **Right-click context menu** - Filter by field values (equals, not equals, contains)
- **Timestamp filtering** - Quick time-range filters (±5 min, ±1 hour, ±24 hours)
- **Row selection** - View detailed record information in a side panel
- **Column management** - Reorder columns via drag-and-drop, auto-size columns
- **Multi-record comparison** - Select multiple rows to compare side-by-side
- **Automatic formatting** - Timestamps, JSON, and multi-line values formatted automatically

## Data Requirements

**When to use:** Use Table when you want to display tabular data from any SQL query result with built-in search and detail viewing capabilities.

Your query can return any column types:
- **Text/String**: Displayed as text, searchable
- **Numeric**: Integer, Float, or other numeric types
- **Timestamp/DateTime**: Automatically formatted with date and time
- **JSON**: Automatically formatted and pretty-printed
`),
		).
		Widget(
			widget.NewMarkdown().
				Title("Example 1: Basic Table").
				Content(`
## Example 1: Basic Table

The minimal usage requires just a SQL query and the Table widget.

**Code:**

` + "```go" + `
widget.NewTable(
    sql.New(
        sql.From("http_logs"),
    ),
).
    Title("Recent HTTP Requests").
    Height(400)
` + "```" + `

**Try these features:**
1. Type in the search box to filter across all columns
2. Right-click any cell to add filters (equals, not equals, contains)
3. Right-click a timestamp to filter by time range
4. Click row checkboxes to view detailed record information
5. Right-click column headers to auto-size or reorder columns
`),
		).
		Widget(
			widget.NewTable(
				sql.New(
					sql.From("http_logs"),
				),
			).
				Title("Recent HTTP Requests").
				Height(400),
		).
		Widget(
			widget.NewMarkdown().
				Title("Example 2: Filtered Table").
				Content(`
## Example 2: Filtered Table

Use SQL WHERE clauses to pre-filter the data before displaying.

**Code:**

` + "```go" + `
widget.NewTable(
    sql.New(
        sql.From("http_logs"),
        sql.Where("status >= 400"),  // Only show errors
    ),
).
    Title("HTTP Errors (4xx/5xx)").
    Height(350)
` + "```" + `
`),
		).
		Widget(
			widget.NewTable(
				sql.New(
					sql.From("http_logs"),
					sql.Where("status >= 400"),
				),
			).
				Title("HTTP Errors (4xx/5xx)").
				Height(350),
		).
		Widget(
			widget.NewMarkdown().
				Title("Example 3: With WHERE Filter").
				Content(`
## Example 3: Combining Filters with WHERE

Use WHERE clauses to filter data and OrderBy to sort results.

**Code:**

` + "```go" + `
widget.NewTable(
    sql.New(
        sql.From("http_logs"),
        sql.Where("duration_ms > 100"),
        sql.OrderBy(sql.Field("duration_ms")),
    ),
).
    Title("Slow Requests (>100ms)").
    Height(350)
` + "```" + `

Note: ` + "`OrderBy`" + ` sorts results by the specified field.
`),
		).
		Widget(
			widget.NewTable(
				sql.New(
					sql.From("http_logs"),
					sql.Where("duration_ms > 100"),
					sql.OrderBy(sql.Field("duration_ms")),
				),
			).
				Title("Slow Requests (>100ms)").
				Height(350),
		).
		Widget(
			widget.NewMarkdown().
				Title("Example 4: Multiple Conditions").
				Content(`
## Example 4: Multiple Filters

Combine multiple WHERE clauses to create complex filters.

**Code:**

` + "```go" + `
widget.NewTable(
    sql.New(
        sql.From("http_logs"),
        sql.Where("status >= 500"),
        sql.Where("duration_ms > 50"),
        sql.OrderBy(sql.Field("timestamp")),
    ),
).
    Title("Server Errors (Slow)").
    Height(400)
` + "```" + `

Multiple ` + "`Where()`" + ` calls are combined with AND logic.
`),
		).
		Widget(
			widget.NewTable(
				sql.New(
					sql.From("http_logs"),
					sql.Where("status >= 500"),
					sql.Where("duration_ms > 50"),
					sql.OrderBy(sql.Field("timestamp")),
				),
			).
				Title("Server Errors (Slow)").
				Height(400),
		).
		Widget(
			widget.NewMarkdown().
				Title("Configuration Reference").
				Content(`
## Widget Configuration

**Builder Methods:**

` + "```go" + `
.Title(string)              // Set the table title
.Height(int)                // Set height in pixels (default: 200)
.Id(string)                 // Set custom widget ID (auto-generated if not set)
.AdjustQuery(...options)    // Modify SQL query with additional options
` + "```" + `

## SQL Query Options

Common SQL builder functions for tables:

` + "```go" + `
sql.From("table_name")             // Specify table
sql.Select(sql.Field("col1"))      // Select specific columns
sql.Where("condition")             // Filter rows (can be called multiple times)
sql.OrderBy(sql.Field("column"))   // Sort results
sql.GroupBy(sql.Field("column"))   // Group results
` + "```" + `

## Data Type Handling

**Timestamps:**
- Automatically formatted as HH:MM:SS DD/MM/YY
- Right-click for time-range filtering

**JSON:**
- Automatically detected (starts with ` + "`{`" + `)
- Pretty-printed in detail panel

**Multi-line text:**
- Displayed in ` + "`<pre>`" + ` tags in detail view
- Preserves formatting and whitespace

**Numeric:**
- Integer and float values displayed with appropriate formatting

## Context Menu Options

**For all cells:**
- Equals - Filter to show only this value
- Not Equals - Exclude this value
- Contains - Filter by partial text match (strings only)

**For timestamp cells:**
- ±5 minutes - Show data within 5 minutes
- ±1 hour - Show data within 1 hour
- ±24 hours - Show data within 24 hours

## Tips & Best Practices

1. **Filter your data**: Use ` + "`WHERE`" + ` clauses to limit the data returned from the database
2. **Order by timestamp**: For log data, use ` + "`OrderBy`" + ` to sort results
3. **Set reasonable heights**: Tables with Height(400-600) provide good balance
4. **Combine with markdown**: Use markdown widgets to provide context above tables
5. **Use search**: The built-in fulltext search filters data client-side after loading

## Migration from Legacy JavaScript API

**Legacy (autoTable):**
` + "```js" + `
const data = await clickhouse.query('/path/to/query.sql', {filters});
const filtered = view(Inputs.search(data, {placeholder: "Search"}));
const selected = view(component.autoTable(data, filtered, {rows: 20}));
display(component.recordDetails(selected));
` + "```" + `

**New Go API:**
` + "```go" + `
widget.NewTable(
    sql.New(sql.From("table_name")),
).
    Title("My Data").
    Height(400)
` + "```" + `

**Key improvements:**
- ✅ All features built-in (no manual wiring)
- ✅ Type-safe Go code
- ✅ Fluent SQL builder API
- ✅ Context menus and filtering included automatically

## Next Steps

- [BarVertical](/docs/widgets/bar-vertical) - Vertical bar charts
- [TimeBar](/docs/widgets/time-bar) - Time series visualization
- [Stats](/docs/widgets/stats) - KPI/statistics display
`),
		)
}
