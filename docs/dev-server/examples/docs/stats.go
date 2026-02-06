package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func Stats() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("Stats Widget").
				Content(`
# Stats Widget

The Stats widget displays key numeric metrics as labeled statistics cards, ideal for showing summary values and KPIs.

**Ideal for:**
- Displaying key performance indicators (KPIs)
- Showing summary statistics (totals, counts)
- Creating dashboard overview sections

## Data Requirements

**When to use:** Stats displays numeric values with labels from your query results.

Your query should return:
- **Multiple rows**: Each row becomes a stat card
- One field for the label (set with ` + "`.TitleField()`" + `)
- One field for the value (set with ` + "`.FillField()`" + `)

## How Stats Work

The Stats widget requires:
1. A query that returns data rows
2. ` + "`.TitleField(field)`" + ` - specifies which column contains the label
3. ` + "`.FillField(field)`" + ` - specifies which column contains the numeric value

Each row in your query result becomes a separate stat card.
`),
		).
		Widget(
			widget.NewMarkdown().
				Title("Basic Stats Example").
				Content(`
## Example: Stats by Status Group

Display count of requests grouped by status. Each status group gets its own stat card.

**Code:**

` + "```go" + `
widget.NewStats(
    sql.New(sql.From("http_logs")),
).
    TitleField(sql.Enum("statusGroup")).
    FillField(sql.Count())
` + "```" + `
`),
		).
		Widget(
			widget.NewStats(
				sql.New(sql.From("http_logs")),
			).
				TitleField(sql.Enum("statusGroup")).
				FillField(sql.Count()),
		).
		Widget(
			widget.NewMarkdown().
				Title("Stats Configuration").
				Content(`
## Widget Options

**Stats-specific:**
- ` + "`.TitleField(field)`" + ` - SQL field containing the label for each stat (required)
- ` + "`.FillField(field)`" + ` - SQL field containing the numeric value (required)
- ` + "`.Id(string)`" + ` - Set a custom widget ID
- ` + "`.AdjustQuery(opts...)`" + ` - Modify the query after creation

## Available Aggregations

Currently, only ` + "`sql.Count()`" + ` is available for aggregations:

` + "```go" + `
sql.Count()  // count(*), alias: "cnt"
` + "```" + `

## SQL Query Pattern

The typical pattern for Stats is:

` + "```go" + `
sql.New(
    sql.From("table"),
    sql.Where("optional_filter"),  // Optional filtering
)
` + "```" + `

Then specify which field is the label and which is the value:

` + "```go" + `
.TitleField(sql.Enum("category"))  // Label from this field
.FillField(sql.Count())            // Value from this field
` + "```" + `

## Important Limitations

**The Go version of Stats is currently very basic.** Many features you might expect are not yet implemented:

### Missing Aggregation Functions (TODO)
- ❌ ` + "`sql.Sum()`" + ` - Sum of values
- ❌ ` + "`sql.Avg()`" + ` - Average of values
- ❌ ` + "`sql.Max()`" + ` - Maximum value
- ❌ ` + "`sql.Min()`" + ` - Minimum value

### Missing Stats Features (TODO)
- ❌ Single stat with title (requires a row in query result)
- ❌ SQL-calculated colors (color column)
- ❌ Default fill color prop
- ❌ Custom formatting
- ❌ Trend indicators (up/down arrows)
- ❌ Percentage displays
- ❌ Sparklines

## Workarounds

Until more aggregation functions are available, you can use raw SQL in ` + "`sql.Field()`" + `:

` + "```go" + `
// Not yet available:
// .FillField(sql.Avg("response_time"))

// Workaround - use Field() with raw SQL:
.FillField(sql.Field("avg(response_time)"))
` + "```" + `

Note: When using raw SQL in Field(), you lose type safety and automatic aliasing.

## Example with Raw SQL

` + "```go" + `
widget.NewStats(
    sql.New(
        sql.From("http_logs"),
        sql.Select(sql.Enum("statusGroup")),
        sql.Select(sql.Field("avg(response_time_ms) as avg_time")),
        sql.GroupBy(sql.Enum("statusGroup")),
    ),
).
    TitleField(sql.Enum("statusGroup")).
    FillField(sql.Field("avg_time"))
` + "```" + `

## Next Steps

- [TimeBar](/docs/widgets/time-bar) - Time series visualization
- [Bar Vertical](/docs/widgets/bar-vertical) - Categorical comparisons
- [Queries](/docs/queries) - Learn more about SQL query building
`),
		)
}
