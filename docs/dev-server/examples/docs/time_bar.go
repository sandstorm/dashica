package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func TimeBar() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("TimeBar Widget").
				Content(`
# TimeBar Widget

The TimeBar widget displays time-series data as bars, with time on the x-axis and numeric values on the y-axis.

**Ideal for:**
- Visualizing time-series data (requests over time, logs per minute)
- Displaying aggregated values over time buckets
- Stacking data by dimensions with color
- Monitoring and observability dashboards

## Data Requirements

**When to use:** TimeBar requires temporal x-values (timestamps) and numeric y-values.

Your query should return:
- **X-axis**: DateTime/Timestamp (temporal data)
- **Y-axis**: Numeric (Integer/Float for counts, sums, averages)
- **Fill** (optional): Text/String for stacking categories

## How the API Works

**IMPORTANT:** The ` + "`.X()`" + ` and ` + "`.Y()`" + ` methods automatically handle SELECT and GROUP BY clauses!

You only need to:
1. Specify the table with ` + "`sql.From(\"table_name\")`" + `
2. Define the X-axis field (e.g., ` + "`sql.Timestamp15Min()`" + `)
3. Define the Y-axis aggregation (e.g., ` + "`sql.Count()`" + `)

The widget will automatically generate the correct SQL SELECT and GROUP BY clauses.
`),
		).
		Widget(
			widget.NewMarkdown().
				Title("Basic Time Series").
				Content(`
## Example 1: Basic Time Series

This shows the simplest TimeBar usage - just counting requests over time in 15-minute buckets.

**Code:**

` + "```go" + `
widget.NewTimeBar(
    sql.New(sql.From("http_logs")),
).
    Title("HTTP Requests Over Time").
    X(sql.Timestamp15Min()).  // Automatically adds SELECT and GROUP BY
    Y(sql.Count()).            // Automatically adds SELECT
    Height(300)
` + "```" + `
`),
		).
		Widget(
			widget.NewTimeBar(
				sql.New(sql.From("http_logs")),
			).
				Title("HTTP Requests Over Time").
				X(sql.Timestamp15Min()).
				Y(sql.Count()).
				Height(300),
		).
		Widget(
			widget.NewMarkdown().
				Title("Stacked by Status Group").
				Content(`
## Example 2: Stacking with Fill()

Use ` + "`.Fill()`" + ` to stack data by additional dimensions and visualize with colors.

**Code:**

` + "```go" + `
widget.NewTimeBar(
    sql.New(sql.From("http_logs")),
).
    Title("HTTP Requests by Status Group").
    X(sql.Timestamp15Min()).
    Y(sql.Count()).
    Fill(sql.Enum("statusGroup")).  // Stack by status
    Height(300)
` + "```" + `
`),
		).
		Widget(
			widget.NewTimeBar(
				sql.New(sql.From("http_logs")),
			).
				Title("HTTP Requests by Status Group").
				X(sql.Timestamp15Min()).
				Y(sql.Count()).
				Fill(sql.Enum("statusGroup")).
				Height(300),
		).
		Widget(
			widget.NewMarkdown().
				Title("Custom Color Mappings").
				Content(`
## Example 3: Custom Color Mappings

Use ` + "`.Color()`" + ` to define custom colors for each category in your data. This is especially useful for semantic coloring (success = green, error = red, etc.).

**Code:**

` + "```go" + `
import "github.com/sandstorm/dashica/lib/dashboard/color"

widget.NewTimeBar(
    sql.New(sql.From("http_logs")),
).
    Title("HTTP Requests with Status Colors").
    X(sql.Timestamp15Min()).
    Y(sql.Count()).
    Fill(sql.Enum("statusGroup")).
    Color(
        color.ColorLegend(true),              // Show legend
        color.ColorMapping("2xx", "#4CAF50"),  // Green for success
        color.ColorMapping("3xx", "#2196F3"),  // Blue for redirects
        color.ColorMapping("4xx", "#FF9800"),  // Orange for client errors
        color.ColorMapping("5xx", "#F44336"),  // Red for server errors
    ).
    Height(300)
` + "```" + `

**Available color options:**
- ` + "`color.ColorLegend(bool)`" + ` - Show/hide the legend
- ` + "`color.ColorMapping(value, color)`" + ` - Map specific values to hex colors
- ` + "`color.ColorUnknown(color)`" + ` - Color for unmapped values (default: #8E44AD)
`),
		).
		Widget(
			widget.NewTimeBar(
				sql.New(sql.From("http_logs")),
			).
				Title("HTTP Requests with Status Colors").
				X(sql.Timestamp15Min()).
				Y(sql.Count()).
				Fill(sql.Enum("statusGroup")).
				Color(
					color.ColorLegend(true),
					color.ColorMapping("2xx", "#4CAF50"),
					color.ColorMapping("3xx", "#2196F3"),
					color.ColorMapping("4xx", "#FF9800"),
					color.ColorMapping("5xx", "#F44336"),
				).
				Height(300),
		).
		Widget(
			widget.NewMarkdown().
				Title("SQL from File").
				Content(`
## Example 4: Loading SQL from File

For complex queries, you can load SQL from external files using ` + "`sql.FromFile()`" + `. This helps keep your code clean and allows you to manage queries separately.

**Code:**

` + "```go" + `
widget.NewTimeBar(sql.FromFile("data/queries/http_requests_by_status.sql")).
    Title("Requests from SQL File").
    X(sql.NewFieldAlias("time")).       // Use field from query
    Y(sql.NewFieldAlias("requests")).   // Use field from query
    Fill(sql.NewFieldAlias("statusGroup")).
    Height(300)
` + "```" + `

**SQL file example** (` + "`data/queries/http_requests_by_status.sql`" + `):

` + "```sql" + `
SELECT
    toStartOfInterval(timestamp, INTERVAL 15 MINUTE) AS time,
    statusGroup,
    count() AS requests
FROM http_logs
GROUP BY time, statusGroup
ORDER BY time
` + "```" + `

**Important notes:**
- The SQL file path is relative to where your Go application runs
- Use ` + "`sql.NewFieldAlias()`" + ` to reference columns from your query
- You have full control over the SQL query (joins, subqueries, CTEs, etc.)
- File-based queries can be combined with ` + "`.Color()`" + ` for custom coloring
`),
		).
		Widget(
			widget.NewTimeBar(sql.FromFile("data/queries/http_requests_by_status.sql")).
				Title("Requests from SQL File").
				X(sql.NewFieldAlias("time")).
				Y(sql.NewFieldAlias("requests")).
				Fill(sql.NewFieldAlias("statusGroup")).
				Color(
					color.ColorLegend(true),
					color.ColorMapping("2xx", "#4CAF50"),
					color.ColorMapping("3xx", "#2196F3"),
					color.ColorMapping("4xx", "#FF9800"),
					color.ColorMapping("5xx", "#F44336"),
				).
				Height(300),
		).
		Widget(
			widget.NewMarkdown().
				Title("Time Bucketing Functions").
				Content(`
## Time Bucketing

**Built-in function:**

` + "```go" + `
sql.Timestamp15Min()  // 15-minute buckets, alias: "time"
` + "```" + `

**Custom time buckets:**

For other bucket sizes, use ` + "`sql.NewTimestampedFieldAlias()`" + ` with the bucket size in milliseconds:

` + "```go" + `
// 1-hour buckets
X(sql.NewTimestampedFieldAlias("time", 60*60*1000))

// Daily buckets
X(sql.NewTimestampedFieldAlias("time", 24*60*60*1000))

// 5-minute buckets
X(sql.NewTimestampedFieldAlias("time", 5*60*1000))
` + "```" + `

**Common bucket sizes in milliseconds:**
- 1 second: ` + "`1000`" + `
- 1 minute: ` + "`60*1000`" + `
- 5 minutes: ` + "`5*60*1000`" + `
- 15 minutes: ` + "`15*60*1000`" + `
- 1 hour: ` + "`60*60*1000`" + `
- 1 day: ` + "`24*60*60*1000`" + `

**Note:** When using custom buckets, your SQL query must provide a field that matches the time bucket. For example:

` + "```sql" + `
SELECT
    toStartOfHour(timestamp) AS time,
    count() AS cnt
FROM http_logs
GROUP BY time
` + "```" + `

## Adding Filters

You can add WHERE clauses to filter data:

` + "```go" + `
baseQuery := sql.New(
    sql.From("http_logs"),
    sql.Where("status >= 200"),
    sql.Where("status < 300"),
)

widget.NewTimeBar(baseQuery).
    X(sql.Timestamp15Min()).
    Y(sql.Count())
` + "```" + `

## Widget Options

**TimeBar-specific:**
- ` + "`.X(field)`" + ` - temporal field for x-axis (required)
- ` + "`.Y(field)`" + ` - numeric field for y-axis (required)
- ` + "`.Fill(field)`" + ` - categorical field for stacking/coloring
- ` + "`.Title(string)`" + ` - chart title
- ` + "`.Height(int)`" + ` - chart height in pixels

**Common options:**
- All charts use 100% of available width and are responsive
- Default height is based on widget type

## Missing Features (TODO)

The Go version does not yet support:
- ❌ Custom color scales (domain/range)
- ❌ Faceting (fx/fy)
- ❌ Custom tooltips (tip)
- ❌ Extra marks (threshold lines, annotations)
- ❌ Logarithmic scale
- ❌ Auto-bucketing based on time range

## Next Steps

- [Bar Vertical](/docs/widgets/bar-vertical) - Vertical bar charts
- [Bar Horizontal](/docs/widgets/bar-horizontal) - Horizontal bar charts
- [Stats](/docs/widgets/stats) - KPI/statistics display
`),
		)
}
