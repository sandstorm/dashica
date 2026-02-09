package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func Installation() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("Installation & Setup").
				Content(`
# Installation & Setup

Dashica is a Go library for building dashboards backed by ClickHouse. Unlike the previous Observable Framework-based version, this Go version is compiled into a single binary.

## Prerequisites

- Go 1.24 or later
- ClickHouse server (for data queries)
- Node.js (for frontend asset building during development)

## Quick Start with Dev Server

The fastest way to explore Dashica:

` + "```bash" + `
# 1. Clone the repository
git clone https://github.com/sandstorm/dashica
cd dashica

# 2. Start ClickHouse with sample data
docker-compose -f docker-compose.dev.yml up -d

# 3. Build frontend assets
npm install
npm run build

# 4. Run the dev server
cd docs/dev-server
cp dashica_config.example.yaml dashica_config.yaml
go run main.go

# 5. Open http://127.0.0.1:8080
` + "```" + `

## Creating a New Dashboard Project

Create a new Go project and add Dashica as a dependency:

` + "```bash" + `
mkdir my-dashica-project
cd my-dashica-project
go mod init example.com/my-dashica
go get github.com/sandstorm/dashica
` + "```" + `

### Configuration File

Create **dashica_config.yaml**:

` + "```yaml" + `
clickhouse:
  default:
    url: http://localhost:8123
    user: default
    password: password
    database: default

  alert_storage:
    url: http://localhost:8123
    user: default
    password: password
    database: default

log:
  file_name: /tmp/dashica.log
  to_stdout: true
` + "```" + `

### Main Application

Create **main.go**:

` + "```go" + `
package main

import (
    "log"
    "net/http"

    "github.com/sandstorm/dashica"
    "github.com/sandstorm/dashica/lib/components/layout"
    "github.com/sandstorm/dashica/lib/dashboard"
    "github.com/sandstorm/dashica/lib/dashboard/sql"
    "github.com/sandstorm/dashica/lib/dashboard/widget"
)

func main() {
    d := dashica.New()

    d.RegisterDashboardGroup("My Dashboards").
        RegisterDashboard("/", dashboard.New().
            WithLayout(layout.DefaultPage).
            Widget(
                widget.NewMarkdown().
                    Title("Hello Dashica").
                    Content("My first dashboard!"),
            ),
        )

    log.Println("Server running at http://127.0.0.1:8080")
    log.Fatal(http.ListenAndServe("127.0.0.1:8080", d))
}
` + "```" + `

### Run Your Dashboard

` + "```bash" + `
go run main.go
# Browse to http://127.0.0.1:8080
` + "```" + `

## Deployment

### Building for Production

` + "```bash" + `
# Build a static binary
CGO_ENABLED=0 go build -o dashica-server

# Copy to your server
scp dashica-server dashica_config.yaml user@server:/opt/dashica/
` + "```" + `

### Running in Production

` + "```bash" + `
# On your server
cd /opt/dashica
./dashica-server
` + "```" + `

### Docker Deployment

TODO: Add Docker deployment instructions

## Differences from Observable Framework Version

The new Go-based version differs from the previous Observable Framework version:

**Advantages:**
- ✅ Single binary deployment (no Node.js needed in production)
- ✅ Better performance
- ✅ Type-safe Go API
- ✅ Easier debugging

**Missing Features (TODO):**
- ❌ Reactive JavaScript in dashboards
- ❌ Markdown files as dashboards
- ❌ Observable Plot direct usage
- ❌ Auto-discovery of dashboards from filesystem

All dashboards must now be defined in Go code.

## Next Steps

- [Quick Start Guide](/docs/quickstart) - Build your first dashboard
- [Queries](/docs/queries) - Learn SQL query patterns
- [Widgets Overview](/docs/widgets-overview) - Explore available widgets
`),
		)
}
