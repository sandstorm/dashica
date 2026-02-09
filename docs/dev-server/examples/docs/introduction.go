package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func Introduction() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("Welcome to Dashica").
				Content(`
## What is Dashica?

Dashica is a Go library for building beautiful, interactive dashboards backed by ClickHouse data.

### Key Features

- **Go-First API**: Build dashboards programmatically with a fluent, type-safe Go API
- **ClickHouse Integration**: Powerful SQL query builder designed for ClickHouse
- **Interactive Widgets**: Rich set of chart types and layout components
- **Self-Hosted**: Run your own dashboard server with full control
- **Observable Plot**: Uses Observable Plot for beautiful, performant visualizations

### Architecture

Dashica follows a simple architecture:

1. **Dashboard Builder**: Define dashboards using Go code
2. **SQL Query Builder**: Construct type-safe ClickHouse queries
3. **Widget System**: Compose dashboards from reusable widgets
4. **HTTP Server**: Serve dashboards over HTTP with built-in routing

### Quick Example

` + "```go" + `
package main

import (
    "github.com/sandstorm/dashica"
    "github.com/sandstorm/dashica/lib/dashboard"
    "github.com/sandstorm/dashica/lib/dashboard/widget"
    "github.com/sandstorm/dashica/lib/dashboard/sql"
)

func main() {
    d := dashica.New()

    d.RegisterDashboard("/", dashboard.New().
        Widget(
            widget.NewTimeBar().
                Title("Requests over Time").
                Query(
                    sql.New().
                        From("http_logs").
                        Select(
                            sql.Timestamp15Min("timestamp", "time"),
                            sql.Count("requests"),
                        ),
                ).
                X("time").
                Y("requests"),
        ),
    )

    http.ListenAndServe(":8080", d)
}
` + "```" + `

### Getting Started

👉 Continue to the [Quick Start Guide](/docs/quickstart) to build your first dashboard.

👉 Or explore the [Widgets Overview](/docs/widgets-overview) to see all available components.
`),
		)
}
