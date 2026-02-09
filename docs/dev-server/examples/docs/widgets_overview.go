package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func WidgetsOverview() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("Widgets Overview").
				Content(`
Dashica provides a rich set of widgets for building interactive dashboards.

## Chart Widgets

### [TimeBar](/docs/widgets/time-bar)

Display time-series data as vertical bars.

` + "```go" + `
widget.NewTimeBar(
    sql.New(sql.From("http_logs")),
).
    Title("Requests per Hour").
    X(sql.Timestamp15Min()).
    Y(sql.Count()).
    Height(300)
` + "```" + `

**Use cases**: Request counts, event tracking, metrics over time

[→ Full TimeBar documentation with live examples](/docs/widgets/time-bar)

---

### [BarVertical](/docs/widgets/bar-vertical)

Vertical bar chart for categorical data.

` + "```go" + `
widget.NewBarVertical(
    sql.New(sql.From("http_logs")),
).
    Title("Requests by Status").
    X(sql.Enum("statusGroup")).
    Y(sql.Count()).
    Height(300)
` + "```" + `

**Use cases**: Rankings, comparisons, categorical data

[→ Full BarVertical documentation with live examples](/docs/widgets/bar-vertical)

---

### [Stats](/docs/widgets/stats)

Display key metrics as large numbers.

` + "```go" + `
widget.NewStats(
    sql.New(sql.From("http_logs")),
).
    TitleField(sql.Enum("statusGroup")).
    FillField(sql.Count())
` + "```" + `

**Use cases**: KPIs, summary metrics, totals

[→ Full Stats documentation with live examples](/docs/widgets/stats)

---

### TimeHeatmap

Heatmap for time-series data with color encoding.

` + "```go" + `
widget.NewTimeHeatmap(
    sql.New(sql.From("logs")),
)
// TODO: Document API
` + "```" + `

**Use cases**: Temporal patterns, activity heatmaps, density visualization

**Status**: ❌ Not yet documented - API to be confirmed

---

### TimeHeatmapOrdinal

Heatmap with categorical/ordinal data.

` + "```go" + `
widget.NewTimeHeatmapOrdinal(
    sql.New(sql.From("logs")),
)
// TODO: Document API
` + "```" + `

**Use cases**: Status tracking, categorical time series, ordinal data

**Status**: ❌ Not yet documented - API to be confirmed

---

## Missing Widgets (TODO)

These widgets are not yet implemented in the Go version:

- ❌ **BarHorizontal** - Horizontal bar charts
- ❌ **AutoTable** - Interactive data tables
- ❌ **Line** - Line charts
- ❌ **Area** - Area charts
- ❌ **Scatter** - Scatter plots
- ❌ **Pie/Donut** - Pie and donut charts

---

## Layout Widgets

### Grid

Organize widgets in a responsive grid layout.

` + "```go" + `
widget.NewGrid().
    Cols(2).
    AddWidget(widget1).
    AddWidget(widget2).
    AddWidget(widget3)
` + "```" + `

**Use cases**: Responsive layouts, multi-column dashboards

---

### CollapsibleGroup

Create collapsible sections for better organization.

` + "```go" + `
widget.NewCollapsibleGroup().
    Title("Advanced Metrics").
    Collapsed(true).
    AddWidget(widget1).
    AddWidget(widget2)
` + "```" + `

**Use cases**: Progressive disclosure, grouping related widgets, reducing clutter

---

## Content Widgets

### Markdown

Display formatted documentation and text content.

` + "```go" + `
widget.NewMarkdown().
    Title("Documentation").
    Content("## Heading\n\nSome **bold** text.")

// Or load from file
widget.NewMarkdown().
    File("docs/intro.md")
` + "```" + `

**Use cases**: Documentation, explanatory text, formatted content

---

### LegacyMarkdown

Backward compatibility for Observable-based dashboards with placeholder support.

` + "```go" + `
widget.NewLegacyMarkdown().
    File("legacy_dashboard.md")
` + "```" + `

**Note**: Use the new ` + "`Markdown`" + ` widget for new projects.

---

## Common Features

Chart widgets support these common features:

### Stacking with Fill

` + "```go" + `
.Fill(sql.Enum("category"))  // Stack by category
` + "```" + `

### Size Control

` + "```go" + `
.Height(300)  // Set height in pixels
` + "```" + `

### Missing Features (TODO)

These common features from the Observable Framework version are not yet available:

- ❌ **Faceting** (fx/fy) - Small multiples for comparing across dimensions
- ❌ **Custom Colors** - Color domain/range mapping
- ❌ **Color Legend Control** - Show/hide legend, position
- ❌ **Tooltips** - Custom tooltip configuration
- ❌ **Width Control** - All charts use 100% width currently
- ❌ **Margins** - Custom margin control (marginLeft, marginTop, etc.)
- ❌ **Extra Marks** - Additional Plot marks like threshold lines

---

## Next Steps

- [TimeBar](/docs/widgets/time-bar) - Time series visualization with live examples
- [BarVertical](/docs/widgets/bar-vertical) - Vertical bar charts with live examples
- [Stats](/docs/widgets/stats) - KPI display with live examples
- [Queries](/docs/queries) - Learn SQL query patterns
`),
		)
}
