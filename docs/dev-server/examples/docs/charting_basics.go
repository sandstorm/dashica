package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func ChartingBasics() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("Chart Types").
				Content(`
# Chart Types

Dashica offers multiple chart types to visualize your data effectively. The key to selecting the right chart depends on understanding your data dimensions.

## Understanding Data Types

**Categorical/Ordinal Data:**
- Represents distinct, named categories with no inherent numerical value
- Examples: error levels (info, warn, error), server names, product types

**Numeric/Continuous Data:**
- Represents measurements on a continuous scale
- Examples: response times (ms), load times, CPU usage percentages

**Temporal Data:**
- Time-based data points
- Examples: timestamps, dates, time series

## Choosing the Right Chart Type

### 1. Time is Important

**When time is a key dimension:**

- **Aggregated statistical values** (counts, averages, sums) → Use **TimeBar**
  - Example: Requests per minute, average response time over time
  - [See TimeBar documentation](/docs/widgets/time-bar)

- **Numerical buckets** (response time ranges) → Use **TimeHeatmap**
  - Example: Request times bucketed as 50-100ms, 100-150ms, 150-200ms
  - Shows distribution of values over time

- **Categorical buckets** (named categories over time) → Use **TimeHeatmapOrdinal**
  - Example: Customer A/B/C activity over time, status codes over time
  - Shows categorical distribution over time

### 2. Comparing Categories

**When comparing distinct categories:**

- **Vertical bars** → Use **BarVertical**
  - Best for: Short category names, time periods (years, months)
  - Natural left-to-right reading
  - [See BarVertical documentation](/docs/widgets/bar-vertical)

- **Horizontal bars** → Use **BarHorizontal**
  - Best for: Long category names, rankings
  - Better label readability
  - Natural top-to-bottom ranking

### 3. Key Metrics at a Glance

**When displaying KPIs or summary statistics:**

- Use **Stats** widget
- Shows labeled numeric values as cards
- Perfect for dashboard headers and overviews
- [See Stats documentation](/docs/widgets/stats)

### 4. Detailed Data Exploration

**When users need to search and inspect records:**

- Use **Table** widget
- Interactive search, filtering, and detail views
- Best for log exploration and data inspection
- [See Table documentation](/docs/widgets/table)

## Decision Flowchart

` + "```" + `
START
  │
  ├─ Time is important?
  │   ├─ Yes → TimeBar (aggregated values)
  │   ├─ Yes → TimeHeatmap (numerical buckets)
  │   └─ Yes → TimeHeatmapOrdinal (categorical buckets)
  │
  ├─ Comparing categories?
  │   ├─ Yes → BarVertical (short labels, time series)
  │   └─ Yes → BarHorizontal (long labels, rankings)
  │
  ├─ Key metrics?
  │   └─ Yes → Stats (KPIs, summary values)
  │
  └─ Detailed exploration?
      └─ Yes → Table (searchable data)
` + "```" + `
`),
		).
		Widget(
			widget.NewMarkdown().
				Title("Common Configuration Options").
				Content(`
## Common Configuration Options

All chart widgets share these configuration options:

### Size and Layout

` + "```go" + `
.Title(string)          // Chart title
.Height(int)            // Height in pixels (default: 200)
.Id(string)             // Custom widget ID (auto-generated if not set)
` + "```" + `

### Margins

Extend margins when you need space for labels:

` + "```go" + `
// Not available in Go API yet - use Plot's built-in margins
// marginLeft, marginRight, marginTop, marginBottom
` + "```" + `

### Visual Styling

` + "```go" + `
.ColorScheme(scheme)    // Custom color mapping
.HideLegend()          // Hide color legend (available on some widgets)
` + "```" + `

### Data Mapping

` + "```go" + `
.X(field)              // X-axis data field
.Y(field)              // Y-axis data field
.Fill(field)           // Color/stacking dimension (optional)
.Fx(field)             // Horizontal faceting (optional)
.Fy(field)             // Vertical faceting (optional)
` + "```" + `
`),
		).
		Widget(
			widget.NewMarkdown().
				Title("Example: Basic Bar Chart").
				Content(`
## Example: Basic Bar Chart

This example shows requests grouped by status:

**Code:**

` + "```go" + `
widget.NewBarVertical(
    sql.New(
        sql.From("http_logs"),
        sql.Select(sql.Enum("statusGroup")),
        sql.Select(sql.Count()),
        sql.GroupBy(sql.Enum("statusGroup")),
    ),
).
    X(sql.Enum("statusGroup")).
    Y(sql.Count()).
    Title("Requests by Status").
    Height(200)
` + "```" + `
`),
		).
		Widget(
			widget.NewBarVertical(
				sql.New(
					sql.From("http_logs"),
					sql.Select(sql.Enum("statusGroup")),
					sql.Select(sql.Count()),
					sql.GroupBy(sql.Enum("statusGroup")),
				),
			).
				X(sql.Enum("statusGroup")).
				Y(sql.Count()).
				Title("Requests by Status").
				Height(200),
		).
		Widget(
			widget.NewMarkdown().
				Title("Data Channels").
				Content(`
## Data Channels

Channels are how you map SQL result columns to visual properties.

**Common channels:**

- ` + "`x`" + ` - X-axis position (horizontal)
- ` + "`y`" + ` - Y-axis position (vertical)
- ` + "`fill`" + ` - Color/stacking dimension
- ` + "`fx`" + ` - Horizontal faceting (split into multiple charts)
- ` + "`fy`" + ` - Vertical faceting (split into multiple charts)

**Channel specification:**

In the Go API, channels are specified using SQL field references:

` + "```go" + `
.X(sql.Enum("statusGroup"))     // Categorical field
.Y(sql.Count())                 // Aggregation
.Fill(sql.Enum("method"))       // Another categorical field
` + "```" + `

**Best practice:** Do calculations in SQL rather than post-processing. Dashica passes query results directly to the chart without modification.
`),
		).
		Widget(
			widget.NewMarkdown().
				Title("Next Steps").
				Content(`
## Next Steps

Explore specific widget documentation:

- [TimeBar](/docs/widgets/time-bar) - Time series visualization
- [BarVertical](/docs/widgets/bar-vertical) - Categorical comparisons
- [Stats](/docs/widgets/stats) - KPI display
- [Table](/docs/widgets/table) - Data exploration
- [Widgets Overview](/docs/widgets-overview) - Complete widget list

Learn more about building dashboards:

- [Queries](/docs/queries) - SQL query building
- [Usage Philosophy](/docs/usage-philosophy) - Design principles
`),
		)
}
