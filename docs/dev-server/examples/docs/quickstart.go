package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func QuickStart() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("Quick Start Guide").
				Content(`
Get up and running with Dashica in minutes.

## Prerequisites

- Go 1.24 or later
- ClickHouse server (for data queries)
- Basic familiarity with Go

## Installation

Add Dashica to your Go project:

` + "```bash" + `
go get github.com/sandstorm/dashica
` + "```" + `

## Your First Dashboard

### Step 1: Create a main.go file

` + "```go" + `
package main

import (
    "log"
    "net/http"

    "github.com/sandstorm/dashica"
    "github.com/sandstorm/dashica/lib/dashboard"
    "github.com/sandstorm/dashica/lib/dashboard/widget"
)

func main() {
    // Create a new Dashica instance
    d := dashica.New()

    // Register a simple dashboard
    d.RegisterDashboard("/", dashboard.New().
        Widget(
            widget.NewMarkdown().
                Title("Hello, Dashica!").
                Content("This is my first dashboard."),
        ),
    )

    // Start the server
    log.Println("Server running on http://127.0.0.1:8080")
    log.Fatal(http.ListenAndServe("127.0.0.1:8080", d))
}
` + "```" + `

### Step 2: Run your dashboard

` + "```bash" + `
go run main.go
` + "```" + `

Open your browser to http://127.0.0.1:8080 and see your dashboard!

## Adding Data

To display real data from ClickHouse, use the SQL query builder:

` + "```go" + `
import (
    "github.com/sandstorm/dashica/lib/dashboard/sql"
    "github.com/sandstorm/dashica/lib/dashboard/widget"
)

// Create a time-series chart
widget.NewTimeBar(
	sql.New(
		sql.From("http_logs"),
	),
).
	Title("HTTP Requests Over Time (Live Data)").
	X(sql.Timestamp15Min()).
	Y(sql.Count()).
	Height(300),
` + "```" + `

### Live Example

Here's the same chart with actual data from the dev server's ClickHouse:
`),
		).
		Widget(
			widget.NewTimeBar(
				sql.New(
					sql.From("http_logs"),
				),
			).
				Title("HTTP Requests Over Time (Live Data)").
				X(sql.Timestamp15Min()).
				Y(sql.Count()).
				Height(300),
		).
		Widget(
			widget.NewMarkdown().
				Content(`

## More Examples

You can also group data by status codes:

` + "```go" + `
widget.NewTimeBar(
    sql.New(
        sql.From("http_logs"),
    ),
).
    Title("Requests by Status").
    X(sql.Timestamp15Min()).
    Y(sql.Count()).
    Fill(sql.Enum("statusGroup")).
    Height(300)
` + "```" + `

### Live Example
`),
		).
		Widget(
			widget.NewTimeBar(
				sql.New(
					sql.From("http_logs"),
				),
			).
				Title("Requests by Status (Live Data)").
				X(sql.Timestamp15Min()).
				Y(sql.Count()).
				Fill(sql.Enum("statusGroup")).
				Height(300),
		).
		Widget(
			widget.NewMarkdown().
				Content(`

## Displaying Data in Tables

For exploring raw data, use the AutoTable widget with interactive features:

` + "```go" + `
widget.NewAutoTable(
    sql.New(
        sql.From("http_logs"),
        sql.Limit(100),
    ),
).
    Title("Recent HTTP Requests").
    Height(400)
` + "```" + `

The AutoTable widget provides:
- **Fulltext search** across all columns
- **Right-click context menu** for filtering (equals, not equals, contains)
- **Timestamp filtering** with time-range options (±5 min, ±1 hour, ±24 hours)
- **Row selection** with detailed view panel
- **Column reordering** and auto-sizing
- **Multi-record comparison** in side-by-side cards

### Live Example
`),
		).
		Widget(
			widget.NewAutoTable(
				sql.New(
					sql.From("http_logs"),
					sql.Limit(100),
				),
			).
				Title("Recent HTTP Requests").
				Height(400),
		).
		Widget(
			widget.NewMarkdown().
				Content(`

Try these interactive features:
1. **Search**: Type in the search box to filter across all columns
2. **Context menu**: Right-click any cell to add filters (e.g., filter by specific hostname or status)
3. **Timestamp filters**: Right-click a timestamp to filter by time range
4. **Row details**: Click row checkboxes to view detailed record information in the bottom panel
5. **Column management**: Right-click column headers to auto-size columns or reorder by dragging

`),
		).
		Widget(
			widget.NewMarkdown().
				Content(`

## Configuration

Configure ClickHouse connection via environment variables:

` + "```bash" + `
export CLICKHOUSE_HOST=localhost:9000
export CLICKHOUSE_DATABASE=default
export CLICKHOUSE_USERNAME=default
export CLICKHOUSE_PASSWORD=secret
` + "```" + `

## Next Steps

- **[Widgets Overview](/docs/widgets-overview)**: Explore all available widgets
- **Widget Examples**: See specific examples for each widget type (coming soon)
- **Advanced Topics**: Learn about layouts, colors, and filters (coming soon)

## Tips

1. **Development Mode**: Set ` + "`LOG_TO_STDOUT=true`" + ` for better debugging
2. **Auto-reload**: Use ` + "`air`" + ` or similar tools for live reloading during development
3. **Multiple Dashboards**: Use ` + "`RegisterDashboardGroup()`" + ` to organize related dashboards

## Troubleshooting

### ClickHouse connection errors

Make sure your ClickHouse server is running and accessible:

` + "```bash" + `
clickhouse-client --host localhost --port 9000
` + "```" + `

### Port already in use

Change the port via the ` + "`PORT`" + ` environment variable:

` + "```bash" + `
PORT=3000 go run main.go
` + "```" + `
`),
		)
}
