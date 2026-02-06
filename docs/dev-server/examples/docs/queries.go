package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func Queries() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("Writing SQL Queries").
				Content(`
# Writing SQL Queries

Dashica uses ClickHouse-specific SQL with a type-safe Go query builder. This guide covers how to construct queries for your dashboards.

## SQL Query Builder

Instead of writing raw SQL strings, you use the ` + "`sql`" + ` package to build queries:

` + "```go" + `
import "github.com/sandstorm/dashica/lib/dashboard/sql"

query := sql.New(
    sql.From("http_logs"),
    sql.Where("status >= 200"),
    sql.Where("status < 300"),
)
` + "```" + `

## Basic Query Structure

A typical query has these components:

` + "```go" + `
sql.New(
    sql.From("table_name"),           // Required: source table
    sql.Where("condition"),           // Optional: filter conditions
    sql.Select(sql.Count()),          // Optional: explicit selections
    sql.GroupBy(sql.Field("col")),    // Optional: grouping
    sql.OrderBy(sql.Field("col")),    // Optional: ordering
)
` + "```" + `

## Automatic SELECT and GROUP BY

**Important:** When you use widget methods like ` + "`.X()`" + ` and ` + "`.Y()`" + `, they automatically add the necessary SELECT and GROUP BY clauses!

` + "```go" + `
// Widget handles SELECT and GROUP BY automatically
widget.NewTimeBar(
    sql.New(sql.From("http_logs")),  // Just specify the table
).
    X(sql.Timestamp15Min()).  // Automatically adds SELECT and GROUP BY
    Y(sql.Count())            // Automatically adds SELECT
` + "```" + `

## Field Functions

### Time Bucketing

` + "```go" + `
sql.Timestamp15Min()  // 15-minute buckets, alias: "time"
sql.Timestamp1Hour()  // 1-hour buckets
sql.Timestamp1Day()   // Daily buckets

// Custom field with alias
sql.NewTimestampedFieldAlias("my_time", 15*60*1000)
` + "```" + `

### Aggregations

` + "```go" + `
sql.Count()                    // count(*), alias: "cnt"
sql.Sum("column_name")         // sum(column_name)
sql.Avg("column_name")         // avg(column_name)
sql.Max("column_name")         // max(column_name)
sql.Min("column_name")         // min(column_name)
` + "```" + `

### Field Types

` + "```go" + `
sql.Field("column_name")                      // Raw field
sql.Enum("status")                            // status::String
sql.JsonExtractString("json_col", "key")      // JSON extraction
sql.NewFieldAlias("alias")                    // Reference by alias
` + "```" + `

## Working with WHERE Clauses

Add multiple conditions:

` + "```go" + `
sql.New(
    sql.From("logs"),
    sql.Where("level = 'error'"),
    sql.Where("timestamp >= now() - INTERVAL 1 HOUR"),
)
` + "```" + `

## Query from File

TODO: Add support for loading queries from SQL files

` + "```go" + `
// NOT YET IMPLEMENTED
sql.FromFile("queries/my_query.sql")
` + "```" + `

## Example Queries

### Simple Time Series

` + "```go" + `
widget.NewTimeBar(
    sql.New(sql.From("http_logs")),
).
    X(sql.Timestamp15Min()).
    Y(sql.Count())
` + "```" + `

### Grouped by Status

` + "```go" + `
widget.NewTimeBar(
    sql.New(sql.From("http_logs")),
).
    X(sql.Timestamp15Min()).
    Y(sql.Count()).
    Fill(sql.Enum("statusGroup"))
` + "```" + `

### With Filters

` + "```go" + `
baseQuery := sql.New(
    sql.From("logs"),
    sql.Where("customer = 'acme'"),
)

widget.NewTimeBar(baseQuery).
    X(sql.Timestamp15Min()).
    Y(sql.Count())
` + "```" + `

### Modifying Queries

You can create variants of a base query:

` + "```go" + `
base := sql.New(
    sql.From("logs"),
    sql.Where("level != 'info'"),
)

// Create modified version
errorOnly := base.With(
    sql.Where("level = 'error'"),
)
` + "```" + `

## Advanced: AdjustQuery

Modify a widget's query after creation:

` + "```go" + `
chart := widget.NewTimeBar(
    sql.New(sql.From("logs")),
).X(sql.Timestamp15Min()).Y(sql.Count())

// Create variant with additional filter
errorChart := chart.AdjustQuery(
    sql.Where("level = 'error'"),
)
` + "```" + `

## ClickHouse-Specific Features

### Functions

` + "```go" + `
sql.Field("toStartOfHour(timestamp)")
sql.Field("replaceOne(path, '/api/', '')")
sql.Field("JSONExtractString(data, 'key')")
` + "```" + `

### Performance Tips

1. Always filter by ` + "`timestamp`" + ` for time-series data
2. Use ` + "`WHERE`" + ` before ` + "`GROUP BY`" + ` when possible
3. Limit result sets for tables
4. Use appropriate time buckets (15min, 1hour, 1day)

## Missing Features (TODO)

- ❌ Global filters (SQL + time range UI)
- ❌ Query parameters
- ❌ ` + "`SkipFilters()`" + ` functionality
- ❌ Query from file support
- ❌ additional_table_filters

## Next Steps

- [Charting Basics](/docs/charting-basics) - TODO
- [Widgets Overview](/docs/widgets-overview) - All available widgets
`),
		).
		Widget(
			widget.NewMarkdown().
				Title("Live Query Example").
				Content(`
## Live Example

Here's a query in action showing request counts over time:
`),
		).
		Widget(
			widget.NewTimeBar(
				sql.New(
					sql.From("http_logs"),
				),
			).
				Title("HTTP Requests by Status").
				X(sql.Timestamp15Min()).
				Y(sql.Count()).
				Fill(sql.Enum("statusGroup")).
				Height(300),
		)
}
