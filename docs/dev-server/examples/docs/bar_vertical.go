package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func BarVertical() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("BarVertical Widget").
				Content(`
# BarVertical Widget

The BarVertical widget displays data as vertical bars, with categories on the x-axis and numeric values on the y-axis.

**Ideal for:**
- Comparing categories (e.g., requests by status code)
- Displaying aggregated values
- Stacking data by additional dimensions
- Showing distributions across discrete categories

## Data Requirements

**When to use:** BarVertical requires categorical x-values and numeric y-values.

Your query should return:
- **X-axis**: Text/String (categorical data like "200", "404", "admin", "user")
- **Y-axis**: Numeric (Integer/Float for counts, sums, averages)
- **Fill** (optional): Text/String for stacking categories

## How the API Works

Like TimeBar, the ` + "`.X()`" + ` and ` + "`.Y()`" + ` methods automatically handle SELECT and GROUP BY clauses.
`),
		).
		Widget(
			widget.NewMarkdown().
				Title("Basic Bar Chart").
				Content(`
## Example 1: Requests by Status

A simple vertical bar chart grouping by status group.

**Code:**

` + "```go" + `
widget.NewBarVertical(
    sql.New(
        sql.From("http_logs"),
    ),
).
    Title("Requests by Status Group").
    X(sql.Enum("statusGroup")).
    Y(sql.Count()).
    Height(300)
` + "```" + `
`),
		).
		Widget(
			widget.NewBarVertical(
				sql.New(
					sql.From("http_logs"),
				),
			).
				Title("Requests by Status Group").
				X(sql.Enum("statusGroup")).
				Y(sql.Count()).
				Height(300),
		).
		Widget(
			widget.NewMarkdown().
				Title("Stacked Bar Chart").
				Content(`
## Example 2: Stacked by Path

Use ` + "`.Fill()`" + ` to stack data by an additional dimension.

**Code:**

` + "```go" + `
widget.NewBarVertical(
    sql.New(
        sql.From("http_logs"),
    ),
).
    Title("Requests by Status and Path").
    X(sql.Enum("statusGroup")).
    Y(sql.Count()).
    Fill(sql.Field("path")).
    Height(300)
` + "```" + `
`),
		).
		Widget(
			widget.NewBarVertical(
				sql.New(
					sql.From("http_logs"),
				),
			).
				Title("Requests by Status and Path").
				X(sql.Enum("statusGroup")).
				Y(sql.Count()).
				Fill(sql.Field("path")).
				Height(300),
		).
		Widget(
			widget.NewMarkdown().
				Title("Field Functions").
				Content(`
## Field Functions for Categorical Data

Use these functions for categorical x-axis values:

` + "```go" + `
sql.Field("column_name")         // Raw field
sql.Enum("status")               // status::String (for enum types)
sql.NewFieldAlias("alias")       // Reference by alias
` + "```" + `

## Aggregation Functions

Common aggregations for y-axis:

` + "```go" + `
sql.Count()                    // count(*), alias: "cnt"
sql.Sum("column_name")         // sum(column_name)
sql.Avg("column_name")         // avg(column_name)
sql.Max("column_name")         // max(column_name)
sql.Min("column_name")         // min(column_name)
` + "```" + `

## Adding Filters

Filter your data with WHERE clauses:

` + "```go" + `
widget.NewBarVertical(
    sql.New(
        sql.From("http_logs"),
        sql.Where("status >= 400"),  // Only errors
    ),
).X(sql.Enum("statusGroup")).Y(sql.Count())
` + "```" + `

## Widget Options

**BarVertical-specific:**
- ` + "`.X(field)`" + ` - categorical field for x-axis (required)
- ` + "`.Y(field)`" + ` - numeric field for y-axis (required)
- ` + "`.Fill(field)`" + ` - categorical field for stacking/coloring
- ` + "`.Title(string)`" + ` - chart title
- ` + "`.Height(int)`" + ` - chart height in pixels

**Common options:**
- All charts use 100% of available width and are responsive
- Use ` + "`.Height(pixels)`" + ` to adjust vertical space

## Missing Features (TODO)

The Go version does not yet support:
- ❌ Custom color scales (domain/range)
- ❌ Color legend hiding
- ❌ Faceting (fx/fy)
- ❌ SQL-calculated colors
- ❌ Custom tooltips

## Next Steps

- [Bar Horizontal](/docs/widgets/bar-horizontal) - Horizontal bar charts
- [TimeBar](/docs/widgets/time-bar) - Time series visualization
- [Stats](/docs/widgets/stats) - KPI/statistics display
`),
		)
}
