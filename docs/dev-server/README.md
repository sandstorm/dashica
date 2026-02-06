# Dashica Dev Server

This is the self-hosted documentation and development environment for Dashica. It serves as both comprehensive documentation and a live testing ground for all widget types.

## Quick Start

### Prerequisites

You'll need:
1. Go 1.24 or later
2. ClickHouse server running (for data examples)
3. Configuration file

### Setup

1. **Create configuration file**:

```bash
cd docs/dev-server
cp dashica_config.example.yaml dashica_config.yaml
```

Edit `dashica_config.yaml` with your ClickHouse connection details.

2. **Run the dev server**:

```bash
go run main.go
```

Or with custom port:

```bash
PORT=3000 go run main.go
```

Then open your browser to: http://127.0.0.1:8080

### Running without ClickHouse

For viewing documentation only (without live data examples), you still need a minimal config file. The server will start but data-driven widgets will fail to load.

## Configuration

### Configuration File

The dev server requires a `dashica_config.yaml` file in the same directory:

```bash
cp dashica_config.example.yaml dashica_config.yaml
```

Edit the file to configure:
- ClickHouse connection settings
- Logging options
- Alert configuration (optional)

### Environment Variables

Additional configuration via environment variables:

```bash
export PORT=8080                # Server port (default: 8080)
export APP_ENV=development      # Environment name (loads dashica_config.yaml)
```

The `APP_ENV` variable controls which config file is loaded:
- Not set or `development`: loads `dashica_config.yaml`
- `production`: loads `dashica_config.production.yaml`
- Custom: loads `dashica_config.<APP_ENV>.yaml`

## What's Available

### 📚 Documentation

- **Introduction** (`/docs/intro`) - Overview of Dashica and its architecture
- **Quick Start** (`/docs/quickstart`) - Getting started guide
- **Widgets Overview** (`/docs/widgets-overview`) - Complete widget reference

### 🎨 Widget Examples (Coming Soon)

Each widget will have dedicated example pages showing:
- Basic usage
- Advanced configurations
- Color schemes
- Faceting and stacking
- Real data examples

Planned examples:
- TimeBar
- BarVertical
- BarHorizontal
- Stats
- TimeHeatmap
- TimeHeatmapOrdinal
- Grid
- CollapsibleGroup

### 🚀 Advanced Examples (Coming Soon)

Real-world dashboard examples demonstrating:
- Multi-widget layouts
- Custom color schemes
- Filter buttons
- Complex queries
- Best practices

## Development

### Project Structure

```
docs/dev-server/
├── main.go                    # Entry point
├── README.md                  # This file
├── examples/
│   ├── docs/                  # Documentation pages
│   │   ├── introduction.go
│   │   ├── quickstart.go
│   │   └── widgets_overview.go
│   ├── widgets/               # Widget examples (to be added)
│   └── advanced/              # Advanced examples (to be added)
└── data/                      # Sample data scripts (to be added)
```

### Adding New Documentation Pages

1. Create a new file in `examples/docs/`:

```go
package docs

import (
    "github.com/sandstorm/dashica/lib/dashboard"
    "github.com/sandstorm/dashica/lib/dashboard/widget"
)

func MyNewPage() dashboard.Dashboard {
    return dashboard.New().
        Widget(
            widget.NewMarkdown().
                Title("My Documentation").
                Content("# Content here..."),
        )
}
```

2. Register it in `main.go`:

```go
d.RegisterDashboardGroup("📚 Documentation").
    RegisterDashboard("/docs/my-page", docs.MyNewPage())
```

### Adding Widget Examples

Widget examples will follow this pattern:

```go
package widgets

import (
    "github.com/sandstorm/dashica/lib/dashboard"
    "github.com/sandstorm/dashica/lib/dashboard/widget"
    "github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TimeBarExample() dashboard.Dashboard {
    return dashboard.New().
        // Documentation section
        Widget(
            widget.NewMarkdown().
                Content("# TimeBar Widget\n\nExplanation here..."),
        ).
        // Live example
        Widget(
            widget.NewTimeBar().
                Title("Example Chart").
                Query(
                    sql.New().
                        From("logs").
                        Select(
                            sql.Timestamp15Min("timestamp", "time"),
                            sql.Count("count"),
                        ),
                ).
                X("time").
                Y("count").
                Height(300),
        )
}
```

## Sample Data Setup (Coming Soon)

For the widget examples to work with real data, you'll need sample data in ClickHouse.

Setup scripts will be provided in `examples/data/` to:
- Create sample tables
- Insert test data
- Provide realistic query examples

## Tips

### Live Reloading

Use [air](https://github.com/cosmtrek/air) for automatic reloading during development:

```bash
# Install air
go install github.com/cosmtrek/air@latest

# Run with air
cd docs/dev-server
air
```

### IDE Integration

Open the dev server directory in your IDE for better code navigation:

```bash
code docs/dev-server  # VS Code
```

### Testing Changes

After modifying widgets or documentation:

1. The server will auto-reload (if using air)
2. Or restart manually: `Ctrl+C` then `go run main.go`
3. Refresh your browser

## Troubleshooting

### Port Already in Use

```bash
# Use a different port
PORT=3000 go run main.go
```

### ClickHouse Connection Errors

Check that ClickHouse is running:

```bash
clickhouse-client --host localhost --port 9000
```

### Module Not Found Errors

Make sure you're in the correct directory:

```bash
cd docs/dev-server
go mod tidy  # If you encounter module issues
```

## Contributing Examples

To contribute new examples:

1. Create your example following the patterns above
2. Test it locally with the dev server
3. Ensure it includes both documentation and working code
4. Submit a pull request

## Related Documentation

- Main project: `../../README.md`
- Rewrite plan: `../REWRITE_PLAN.md`
- Self-hosted docs plan: `../2026_02_06_selfhosted_docs_ai.md`

## Support

For issues or questions:
- Check the [main repository issues](https://github.com/sandstorm/dashica/issues)
- Review the documentation at `/docs/intro`
- Examine existing examples in `examples/`
