# Dashica Dev Server

This is the self-hosted documentation and development environment for Dashica. It serves as both comprehensive documentation and a live testing ground for all widget types.

## Quick Start

### Option 1: Using Docker Compose (Recommended)

The easiest way to get started with a ready-to-use ClickHouse instance:

1. **Start ClickHouse with sample data**:

```bash
# From project root
docker-compose -f docker-compose.dev.yml up -d

# Wait for ClickHouse to be ready (about 10-30 seconds)
docker-compose -f docker-compose.dev.yml logs -f clickhouse
# Look for "Ready for connections"
```

2. **Create configuration file**:

```bash
cd docs/dev-server
cp dashica_config.example.yaml dashica_config.yaml
# No need to edit - default settings work with Docker setup!
```

3. **Run the dev server**:

```bash
go run main.go
```

4. **Open your browser**: http://127.0.0.1:8080/docs/intro

That's it! ClickHouse is now running with sample data at:
- HTTP Interface: http://localhost:8123/play
- Native protocol: localhost:9000

### Option 2: Using Your Own ClickHouse

If you have an existing ClickHouse instance:

1. **Create configuration file**:

```bash
cd docs/dev-server
cp dashica_config.example.yaml dashica_config.yaml
```

2. **Edit `dashica_config.yaml`** with your ClickHouse connection details.

3. **Load sample data** (optional):

```bash
clickhouse-client < data/init-scripts/01_create_tables.sql
clickhouse-client < data/init-scripts/02_populate_sample_data.sql
```

4. **Run the dev server**:

```bash
go run main.go
```

Or with custom port:

```bash
PORT=3000 go run main.go
```

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

## Managing Docker Setup

### Stop ClickHouse

```bash
docker-compose -f docker-compose.dev.yml stop
```

### Restart ClickHouse

```bash
docker-compose -f docker-compose.dev.yml restart
```

### Reset Database (Clear All Data)

```bash
# Stop and remove containers and volumes
docker-compose -f docker-compose.dev.yml down -v

# Start fresh (will re-run initialization scripts)
docker-compose -f docker-compose.dev.yml up -d
```

### View ClickHouse Logs

```bash
docker-compose -f docker-compose.dev.yml logs -f clickhouse
```

### Query the Database

```bash
# Using clickhouse-client in the container
docker exec -it dashica-dev-clickhouse clickhouse-client

# Example queries
SELECT count() FROM http_logs;
SELECT statusGroup, count() FROM http_logs GROUP BY statusGroup;
```

Or open the web UI: http://localhost:8123/play

## Troubleshooting

### Port Already in Use (Dev Server)

```bash
# Use a different port for the dev server
PORT=3000 go run main.go
```

### Port Already in Use (Docker)

If ports 8123 or 9000 are already in use, edit `docker-compose.dev.yml`:

```yaml
ports:
  - "18123:8123"  # Change to different port
  - "19000:9000"  # Change to different port
```

Then update your `dashica_config.yaml` to match.

### ClickHouse Connection Errors

Check that ClickHouse is running:

```bash
# Check container status
docker-compose -f docker-compose.dev.yml ps

# Check logs
docker-compose -f docker-compose.dev.yml logs clickhouse

# Test connection
docker exec -it dashica-dev-clickhouse clickhouse-client --query "SELECT 1"
```

### Sample Data Not Loading

If you don't see any data in the tables:

```bash
# Check if tables exist
docker exec -it dashica-dev-clickhouse clickhouse-client --query "SHOW TABLES"

# Reset and reload
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
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
