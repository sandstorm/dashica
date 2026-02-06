package docs

import (
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func WidgetsOverview() dashboard.Dashboard {
	return dashboard.New().
		Widget(
			widget.NewMarkdown().
				Title("Widgets Overview").
				Content(`
Dashica provides a rich set of widgets for building interactive dashboards.

## Chart Widgets

### TimeBar

Display time-series data as vertical bars.

` + "```go" + `
widget.NewTimeBar().
    Title("Requests per Hour").
    Query(sql.New()...).
    X("timestamp").
    Y("count").
    Height(200)
` + "```" + `

**Use cases**: Request counts, event tracking, metrics over time

---

### BarVertical

Vertical bar chart for categorical data.

` + "```go" + `
widget.NewBarVertical().
    Title("Top Pages").
    Query(sql.New()...).
    X("page").
    Y("views").
    Height(200)
` + "```" + `

**Use cases**: Rankings, comparisons, categorical data

---

### BarHorizontal

Horizontal bar chart, ideal for longer labels.

` + "```go" + `
widget.NewBarHorizontal().
    Title("Error Types").
    Query(sql.New()...).
    X("count").
    Y("error_type").
    Height(300)
` + "```" + `

**Use cases**: Long category names, space-constrained layouts

---

### Stats

Display key metrics as large numbers.

` + "```go" + `
widget.NewStats(
    sql.New().
        From("metrics").
        Select(
            sql.Field("metric_name"),
            sql.Count("value"),
        ),
).
TitleField(sql.Field("metric_name")).
FillField(sql.Field("value"))
` + "```" + `

**Use cases**: KPIs, summary metrics, totals

---

### TimeHeatmap

Heatmap for time-series data with color encoding.

` + "```go" + `
widget.NewTimeHeatmap().
    Title("Activity by Hour").
    Query(sql.New()...).
    X("hour").
    Y("day_of_week").
    Fill("activity_count")
` + "```" + `

**Use cases**: Temporal patterns, activity heatmaps, density visualization

---

### TimeHeatmapOrdinal

Heatmap with categorical/ordinal data.

` + "```go" + `
widget.NewTimeHeatmapOrdinal().
    Title("Status by Service").
    Query(sql.New()...).
    X("service").
    Y("timestamp").
    Fill("status")
` + "```" + `

**Use cases**: Status tracking, categorical time series, ordinal data

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

All chart widgets support these common features:

### Stacking with Fill

` + "```go" + `
.Fill("category")  // Stack by category
` + "```" + `

### Faceting (Small Multiples)

` + "```go" + `
.Fx("region")  // Facet horizontally
.Fy("service") // Facet vertically
` + "```" + `

### Custom Colors

` + "```go" + `
.Color(widget.ColorMapping{
    Domain: []string{"success", "error"},
    Range:  []string{"#22c55e", "#ef4444"},
})
` + "```" + `

### Size Control

` + "```go" + `
.Height(300)
.Width(600)
` + "```" + `

---

## Next Steps

Explore detailed examples for each widget type in the **Widget Examples** section (coming soon).
`),
		)
}
