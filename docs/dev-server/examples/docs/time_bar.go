package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
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
				Title("Time Bucketing Functions").
				Content(`
## Time Bucketing

Dashica provides several time bucketing functions:

` + "```go" + `
sql.Timestamp15Min()  // 15-minute buckets, alias: "time"
sql.Timestamp1Hour()  // 1-hour buckets
sql.Timestamp1Day()   // Daily buckets

// Custom bucket with alias
sql.NewTimestampedFieldAlias("my_time", 15*60*1000)
` + "```" + `

Common bucket sizes in milliseconds:
- 1 second: ` + "`1000`" + `
- 1 minute: ` + "`60*1000`" + `
- 5 minutes: ` + "`5*60*1000`" + `
- 15 minutes: ` + "`15*60*1000`" + `
- 1 hour: ` + "`60*60*1000`" + `
- 1 day: ` + "`24*60*60*1000`" + `

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
