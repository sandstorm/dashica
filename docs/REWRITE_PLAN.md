# Dashica Standalone Golang Rewrite - Comprehensive Plan

## Context

This is a **major architectural rewrite** of Dashica, transforming it from an NPM-based CLI tool with a Node.js server into a **standalone Go application** with an embedded frontend. This rewrite is happening on the `standalone-golang` branch.

### Why This Rewrite?

**Previous Architecture (NPM-based):**
- Dashica was distributed as an NPM package (`npm/dashica/`)
- Had a Node.js-based CLI with commands (init, server, dist, preview-frontend, clickhouse-cli)
- Server code was in `server/` directory
- Frontend was bundled with the NPM package
- Complex distribution model with platform-specific packages (`@dashica/darwin-arm64`, `@dashica/linux-x64`, etc.)
- Deployment required Node.js runtime

**New Architecture (Standalone Go):**
- Dashica is now a **Go library** that can be embedded in Go applications
- Public API for programmatic dashboard creation with fluent interface
- Server-side rendering using Go templates (templ)
- Cleaner code organization with `lib/` structure
- Frontend built separately and embedded
- Simpler deployment - compile your own binary with your dashboards
- Users write their own main.go importing dashboard functions

**Example Usage:**
```go
package main
import (
    "log"
    "net/http"
    "github.com/sandstorm/dashica"
    "sandstorm.de/dashica-dashboards/src/falco"
    "sandstorm.de/dashica-dashboards/src/p_oekokiste"
)

func main() {
    d := dashica.New()
    d.RegisterDashboardGroup("Ökokiste").
      RegisterDashboard("/p_oekokiste/new", p_oekokiste.OekokisteOverview()).
      RegisterDashboardGroup("Falco").
      RegisterDashboard("/falco/falco_alerts_overview", falco.AlertOverview()).
      ScanAndRegisterMarkdownDashboards("src/", "")

    log.Fatal(http.ListenAndServe("127.0.0.1:8080", d))
}
```

## Architecture Overview

### Directory Structure Changes

**Old Structure:**
```
npm/dashica/
  ├── src/              # Frontend TypeScript code
  ├── cli/              # CLI commands (Node.js)
  └── bin/dashica       # CLI entry point
server/
  ├── core/             # Server core logic
  ├── httpserver/       # HTTP handlers
  ├── clickhouse/       # ClickHouse client
  └── alerting/         # Alerting system
```

**New Structure:**
```
dashica.go                    # Main public API
dashica_autoregister.go       # Auto-registration for markdown dashboards
frontend/                     # Frontend code (TypeScript/JS)
  ├── chart/                  # Chart implementations
  ├── components/             # UI components
  ├── legacy/                 # Legacy compatibility layer
  └── index.js                # Frontend entry point
lib/                          # Core Go library
  ├── dashboard/              # Dashboard definitions & widgets
  │   ├── widget/            # Widget implementations
  │   ├── rendering/         # Rendering context
  │   └── sql/               # SQL query building
  ├── components/            # Go templates (*.templ files)
  │   ├── layout/           # Page layouts
  │   └── widget_component/ # Widget templates
  ├── httpserver/           # HTTP handlers
  ├── clickhouse/           # ClickHouse client
  ├── alerting/             # Alerting system
  └── config/               # Configuration
server/                      # Legacy server entry point
  └── cmd/dashica-server/   # Main for standalone server (DEPRECATED)
frontendBuild.mjs           # Frontend build script (esbuild)
```

### Key Components

**1. Public API (`dashica.go`):**
```go
type Dashica interface {
    http.Handler
    Config() config.Config
    Log() zerolog.Logger
    RegisterDashboardGroup(title string) Dashica
    RegisterDashboard(url string, dashboard dashboard.Dashboard) Dashica
    ScanAndRegisterMarkdownDashboards(baseDir string, pathPrefix string) Dashica
}
```

**2. Dashboard System (`lib/dashboard/`):**
- `dashboard.go` - Dashboard builder API
- `widget/` - Widget implementations (stats, timeBar, barVertical, barHorizontal, timeHeatmap, etc.)
- `sql/` - SQL query building from files
- `rendering/` - Rendering context for widgets

**3. Go Templates (`lib/components/*.templ`):**
- `layout/default_page.templ` - Main page layout
- `layout/SearchBar.templ` - Search bar component
- `widget_component/*.templ` - Widget rendering templates

**4. Frontend (`frontend/`):**
- Chart implementations using Observable Plot
- Alpine.js for interactivity
- Tailwind CSS + DaisyUI for styling
- Legacy compatibility layer for old dashboards

## Current State - What's Been Completed

Based on recent commits (last 20):
- ✅ Core Go API structure (`dashica.go`, `dashica_autoregister.go`)
- ✅ Basic widget system (timeBar, barVertical, barHorizontal, stats, timeHeatmap, timeHeatmapOrdinal)
- ✅ Frontend migration (charts, components moved to `frontend/`)
- ✅ Go template system (7 `.templ` files created)
- ✅ Build system (`frontendBuild.mjs` using esbuild)
- ✅ Oekokiste overview partially migrated
- ✅ Debug drawer basic functionality
- ✅ Auto-width charts working
- ✅ Color scheme detection
- ✅ Legacy query endpoint structure
- ✅ SQL query building from files

**Statistics:**
- 51 Go files in `lib/` directory
- 23 frontend files (TypeScript/JavaScript/CSS)
- 7 Go template files (`.templ`)
- 132 files changed in this branch
- ~5,890 insertions, ~6,607 deletions

## Remaining Work - What Needs to Be Done

### 1. Complete Widget Migration ✅
**Status:** COMPLETE
**Confirmed Working:**
- TimeBar, BarVertical, BarHorizontal, TimeHeatmap, TimeHeatmapOrdinal, Stats, CollapsibleGroup, Grid, Table

### 2. Fix Critical Security Issues
**Status:** TODO - High Priority
**Issue:** Path traversal vulnerability in speedscope query
**Location:** `lib/httpserver/speedscope_query.go:25`
```go
// TODO: SANITIZE FILE STRING -> SECURITY!!! -> NO PARENT PATH TRAVERSAL ETC.
```

**Action Required:**
- Implement path sanitization
- Validate file paths against allowed directories
- Add security tests

### 3. Complete Legacy Query Endpoint
**Status:** WIP - Multiple TODOs
**Location:** `lib/httpserver/query_new.go`
**TODOs:**
- Line 65: Add proper error handling
- Line 70, 80: Implement custom time parsing
- Line 135: Implement for legacy support
- Line 177: Add different server support per dashboard

### 4. Clean Up SQL Generation
**Status:** WIP - Pragmatic workarounds in place
**Locations:**
- `lib/dashboard/sql/from_file.go` - Lines 25, 44, 49 have TODOs
- `lib/dashboard/sql/sql_builder.go` - Line 8, 85 have TODOs

**Actions:**
- Remove pragmatic workarounds
- Clean up auto-generated query comments
- Finalize SQL builder API

### 5. Enhance Alerting System
**Status:** Basic working, enhancements needed
**TODOs:**
- `lib/alerting/alert_configuration.go:62-63` - Warning levels and dynamic thresholds
- `lib/alerting/alertmanager.go:170` - Deduplication mode for log lines
- `lib/alerting/alert_result_store.go:91, 142-143` - Alert result timestamp handling

### 6. Remove Deprecated NPM and Server Structure
**Status:** Partially removed
**Remaining:**
- Platform-specific packages still in `npm/@dashica/*` (darwin-arm64, linux-x64, etc.)
- Old CLI code in `npm/dashica/src/cli/`
- **DEPRECATED:** `server/cmd/dashica-server/main.go` - this old server entry point should be REMOVED
- Unused npm dependencies

**Actions:**
- Complete removal of `npm/dashica/` and `npm/@dashica/`
- **REMOVE:** `server/cmd/dashica-server/` - users now write their own main.go
- Clean up `package.json` - keep only frontend build dependencies
- Update `.gitignore` accordingly
- Update README with example of new usage pattern

### 7. Test and Validate
**Status:** Basic testing done
**Needs:**
- Comprehensive testing of all dashboards in `docs/src/`
- Verify Oekokiste overview fully works
- Test debug drawer end-to-end
- Validate chart rendering (auto-width, color schemes)
- Performance testing
- E2E test in `lib/clickhouse/clickhouse_e2e_test.go:35` needs to be enabled

### 8. Update Build and Deployment
**Status:** Basic working
**Needs:**
- Verify `frontendBuild.mjs` produces correct output to `public/dist/`
- Test goreleaser configuration for standalone binary
- Update Docker image build process
- Document binary distribution

### 9. Documentation Updates
**Status:** ✅ IN PROGRESS
**Critical documentation changes needed:**
- ✅ Create `docs/REWRITE_PLAN.md` - This file
- ✅ Create `AGENT.md` - Project context for AI assistants
- 🔄 Update README.md with new architecture
- 🔄 Change installation from `npm install dashica` to binary download
- 🔄 Document the Go embedding API
- 🔄 Remove references to CLI commands
- 🔄 Add examples of programmatic usage
- 🔄 Update deployment guide for standalone binary

### 10. Configuration Migration
**Status:** Config system exists
**Verify:**
- `dashica_config.yaml` format compatibility
- All old config options supported
- Migration path for existing users

## Critical Files

### Core API Files
1. `/home/sebastian/dashica/dashica.go` - Main public API
2. `/home/sebastian/dashica/dashica_autoregister.go` - Markdown auto-registration
3. `/home/sebastian/dashica/server/cmd/dashica-server/main.go` - Standalone server entry point (DEPRECATED)

### Library Structure
4. `/home/sebastian/dashica/lib/dashboard/dashboard.go` - Dashboard builder
5. `/home/sebastian/dashica/lib/dashboard/rendering/rendering_context.go` - Rendering context
6. `/home/sebastian/dashica/lib/dashboard/widget/*.go` - Widget implementations
7. `/home/sebastian/dashica/lib/httpserver/query_new.go` - Query endpoint
8. `/home/sebastian/dashica/lib/httpserver/speedscope_query.go` - **Security issue here**

### Frontend Files
9. `/home/sebastian/dashica/frontend/index.js` - Frontend entry point
10. `/home/sebastian/dashica/frontend/chart/*.ts` - Chart implementations
11. `/home/sebastian/dashica/frontendBuild.mjs` - Build configuration

### Templates
12. `/home/sebastian/dashica/lib/components/layout/default_page.templ` - Page layout
13. `/home/sebastian/dashica/lib/components/widget_component/*.templ` - Widget templates

### Configuration
14. `/home/sebastian/dashica/package.json` - Frontend dependencies
15. `/home/sebastian/dashica/go.mod` - Go dependencies

## Migration Strategy for Existing Users

### Breaking Changes
1. **Installation:** From `npm install dashica` → Download binary or embed as Go library
2. **CLI Commands:** Removed - now a library/server
3. **Configuration:** May need updates for new server
4. **Deployment:** Node.js → Go binary

### Compatibility Layer
- Legacy query endpoint maintains backward compatibility
- Old markdown dashboards still work via `ScanAndRegisterMarkdownDashboards`
- ClickHouse schema unchanged

## Verification Plan

### Build Verification
```bash
# Build frontend
node frontendBuild.mjs

# Build Go binary
go build -o dashica ./server/cmd/dashica-server

# Run standalone server
./dashica
```

### Testing
```bash
# Run unit tests
go test ./...

# Run E2E tests
dev tests_run_all

# Start local dev environment
docker compose up
```

### Manual Testing
1. Start server: `./dashica` or `go run ./server/cmd/dashica-server`
2. Open http://127.0.0.1:8080
3. Verify dashboards load correctly
4. Test all chart types render
5. Test debug drawer functionality
6. Verify alerting works
7. Test ClickHouse queries
8. Check auto-width charts
9. Verify color scheme detection

### Integration Points to Test
- [ ] Dashboard auto-registration from markdown files
- [ ] Widget rendering (all types)
- [ ] Chart interactivity
- [ ] Time range selection
- [ ] Search functionality
- [ ] Alert evaluation
- [ ] Alert result storage
- [ ] ClickHouse connectivity
- [ ] Multi-server ClickHouse support
- [ ] Static file serving (`/public/`)

## Success Criteria

This rewrite is complete when:
1. ✅ All widgets from old system work in new system
2. ⏳ Security issues resolved (path traversal)
3. ⏳ All TODOs in code addressed or documented as future work
4. ⏳ Legacy query endpoint fully functional
5. ⏳ All tests passing (unit + E2E)
6. ✅ Documentation files created:
   - ✅ `docs/REWRITE_PLAN.md` - This comprehensive plan
   - ✅ `AGENT.md` - Project context and best practices for AI assistants
7. ⏳ Documentation updated (README, installation, usage examples)
8. ⏳ User applications build and run correctly with new API
9. ⏳ Existing dashboards (like Oekokiste) all work
10. ⏳ No references to old npm/server/cmd structure remain
11. ⏳ Ready for production deployment

## Widget System - Implemented

Based on the Oekokiste example dashboard, these widgets are confirmed working:
- ✅ `widget.NewTimeBar()` - Time-series bar charts
- ✅ `widget.NewBarVertical()` - Vertical bar charts
- ✅ `widget.NewBarHorizontal()` - Horizontal bar charts
- ✅ `widget.NewTimeHeatmap()` - Time-based heatmaps
- ✅ `widget.NewTimeHeatmapOrdinal()` - Ordinal time heatmaps
- ✅ `widget.NewStats()` - Statistics cards
- ✅ `widget.NewCollapsibleGroup()` - Collapsible sections
- ✅ `widget.NewGrid()` - Grid layouts with CSS Grid template areas
- ✅ Legacy table support via frontend autoTable component

## SQL Builder API - Implemented

The SQL builder has a mature fluent API:
- ✅ `sql.New()` - Create base query
- ✅ `sql.From()` - FROM clause
- ✅ `sql.Where()` - WHERE clauses
- ✅ `sql.Select()` - SELECT fields
- ✅ `sql.Field()` - Field definitions
- ✅ `sql.Count()` - COUNT aggregation
- ✅ `sql.Timestamp15Min()` - Time bucketing
- ✅ `sql.JsonExtractString()` - JSON extraction
- ✅ `sql.FromFile()` - Load SQL from file
- ✅ `sql.FromFileWithoutFilters()` - Load without applying filters
- ✅ `sql.NewFieldAlias()` - Field aliasing
- ✅ `sql.NewTimestampedFieldAlias()` - Timestamped field aliasing
- ✅ `sql.OrderBy()` - ORDER BY clause
- ✅ `sql.Limit()` - LIMIT clause

## Dashboard Builder API - Implemented

- ✅ `dashboard.New()` - Create dashboard
- ✅ `.WithLayout()` - Set layout
- ✅ `.FilterButton()` - Add filter buttons
- ✅ `.Widget()` - Add widgets
- ✅ `.AdjustQuery()` - Modify base queries for widget variations

## Widget Configuration API - Implemented

Widgets support extensive configuration:
- ✅ `.Title()` - Set title
- ✅ `.X()`, `.Y()`, `.Fill()` - Axis/fill mappings
- ✅ `.Height()` - Set height
- ✅ `.MarginLeft()`, `.MarginBottom()`, `.MarginRight()`, `.MarginTop()` - Margins
- ✅ `.Color()` - Color configuration with ColorLegend, ColorMapping
- ✅ `.Fx()`, `.Fy()` - Facet axes
- ✅ `.YBucketSize()` - Y-axis bucket size

## Next Steps (Priority Order)

### Phase 1: Documentation (HIGH PRIORITY) ✅
1. ✅ **Create docs/REWRITE_PLAN.md** - This comprehensive plan
2. ✅ **Create AGENT.md** - Project context for AI assistants
3. ⏳ **Update README** - New architecture and usage

### Phase 2: Critical Issues (HIGH PRIORITY)
4. ⏳ **Fix security issue** - Path traversal in `speedscope_query.go`
5. ⏳ **Complete legacy query endpoint** - Fix all TODOs in `query_new.go`
6. ⏳ **Enable E2E tests** - Fix disabled test in `clickhouse_e2e_test.go`

### Phase 3: Cleanup (MEDIUM PRIORITY)
7. ⏳ **Clean up SQL generation** - Remove TODOs and pragmatic workarounds
8. ⏳ **Remove deprecated code** - Delete `server/cmd/`, `npm/dashica/`, `npm/@dashica/`
9. ⏳ **Clean up code TODOs** - Address remaining technical debt

### Phase 4: Testing & Polish (MEDIUM PRIORITY)
10. ⏳ **Test all dashboards end-to-end** - Verify Oekokiste, docs/src/, and __testing/ dashboards
11. ⏳ **Enhance alerting features** - Warning levels, deduplication mode
12. ⏳ **Verify build and deployment** - Frontend build, goreleaser, Docker

## Status: Active Development

This rewrite is in active development on the `standalone-golang` branch. The core architecture is complete and functional. Current focus is on completing critical security fixes, cleaning up TODOs, and comprehensive documentation.

**Last Updated:** 2026-02-06
