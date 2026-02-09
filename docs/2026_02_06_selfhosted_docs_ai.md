# Self-Hosted Documentation & Dev Environment Plan
**Date:** 2026-02-06
**Status:** Planning Phase
**Goal:** Create a self-hosted documentation and development environment for Dashica standalone, with comprehensive examples for all dashboard types

## Context

Following the standalone Golang rewrite (see `REWRITE_PLAN.md`), Dashica is now a Go library with a public API for programmatic dashboard creation. We need:

1. **Self-hosted documentation** that lives in `docs/` and is served by Dashica itself
2. **Complete examples** for all widget types using the new Go API
3. **Development environment** that serves as both docs and testing ground
4. **New Markdown component** (separate from legacy) for rendering documentation

## Goals

### Primary Goals
1. ✅ **Self-hosting**: Documentation served by Dashica itself at `/docs/` routes
2. ✅ **Comprehensive Examples**: Working examples for every widget type
3. ✅ **Development Environment**: Easy way to test and develop new features
4. ✅ **Documentation as Code**: Examples that actually run and can't drift from reality

### Secondary Goals
- Easy navigation between examples
- Code highlighting and formatting
- Live examples that query "real" ClickHouse data
  - A way to fake these clickhouse datasets easily.
- Copy-paste ready code snippets
- Performance considerations documented

## Architecture Overview

### High-Level Design

```
docs/ # Self-hosted dev server
│   ├── main.go             # Entry point for dev environment
│   └── examples/           # All example dashboards
│       ├── widgets/        # Widget examples (Go implementations)
│       ├── data/           # Sample SQL queries
│       └── docs/           # Documentation pages (Markdown)
└── 2026_02_06_selfhosted_docs_ai.md  # This file
```

### Components Needed

#### 1. New Markdown Widget (`widget.Markdown`)
**Purpose:** Render formatted documentation pages (NOT for legacy Observable dashboards)

**Key Differences from `LegacyMarkdown`:**
- `LegacyMarkdown`: For backward compatibility with Observable-based dashboards
  - Supports `$placeholder` syntax
  - Integrates with frontend JS execution
  - Located at `lib/dashboard/widget/legacy_markdown.go`

- `Markdown` (NEW): For pure documentation rendering
  - Clean Markdown → HTML rendering
  - Syntax highlighting for code blocks
  - No placeholder magic or JS execution
  - Simple and fast

**API Design:**
```go
widget.NewMarkdown().
    Content("# Hello\nMarkdown content here").
    // OR
    File("docs/examples/intro.md").
    Title("Introduction")
```

**Implementation Requirements:**
- Use `goldmark` with GFM extensions (same as LegacyMarkdown)
- Add syntax highlighting extension for code blocks
- Support auto-heading IDs for anchor links
- Render to clean HTML without extra wrapper divs
- No dependencies on frontend JavaScript

#### 2. Dev Server (`docs/docs-main.go`)
**Purpose:** Self-hosted server for documentation and examples

```go
package main

import (
    "log"
    "net/http"
    "github.com/sandstorm/dashica"
    // Import all example packages
    "github.com/sandstorm/dashica/docs/dev-server/examples/widgets"
    "github.com/sandstorm/dashica/docs/dev-server/examples/docs"
)

func main() {
    d := dashica.New()

    // Documentation section
    d.RegisterDashboardGroup("📚 Documentation").
        RegisterDashboard("/docs/intro", docs.Introduction()).
        RegisterDashboard("/docs/quickstart", docs.QuickStart()).
        RegisterDashboard("/docs/widgets-overview", docs.WidgetsOverview())

    // Widget Examples section
    d.RegisterDashboardGroup("🎨 Widget Examples").
        RegisterDashboard("/examples/widgets/time-bar", widgets.TimeBarExample()).
        RegisterDashboard("/examples/widgets/bar-vertical", widgets.BarVerticalExample()).
        RegisterDashboard("/examples/widgets/bar-horizontal", widgets.BarHorizontalExample()).
        RegisterDashboard("/examples/widgets/stats", widgets.StatsExample()).
        RegisterDashboard("/examples/widgets/time-heatmap", widgets.TimeHeatmapExample()).
        RegisterDashboard("/examples/widgets/time-heatmap-ordinal", widgets.TimeHeatmapOrdinalExample()).
        RegisterDashboard("/examples/widgets/grid", widgets.GridExample()).
        RegisterDashboard("/examples/widgets/collapsible-group", widgets.CollapsibleGroupExample())

    // Advanced Examples section
    d.RegisterDashboardGroup("🚀 Advanced Examples").
        RegisterDashboard("/examples/advanced/multi-widget", widgets.MultiWidgetDashboard()).
        RegisterDashboard("/examples/advanced/custom-layout", widgets.CustomLayoutExample()).
        RegisterDashboard("/examples/advanced/filter-buttons", widgets.FilterButtonsExample()).
        RegisterDashboard("/examples/advanced/color-schemes", widgets.ColorSchemesExample())

    log.Println("Starting Dashica dev server on http://127.0.0.1:8080")
    log.Fatal(http.ListenAndServe("127.0.0.1:8080", d))
}
```

#### 3. Widget Example Dashboards

Each widget type gets:
1. **Dedicated example dashboard** with live data
2. **Documentation page** explaining usage
3. **Multiple variants** showing different configurations

**Example structure for TimeBar:**

```go
// docs/dev-server/examples/widgets/time_bar_example.go
package widgets

import (
    "github.com/sandstorm/dashica/lib/dashboard"
    "github.com/sandstorm/dashica/lib/dashboard/widget"
    "github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TimeBarExample() dashboard.Dashboard {
    return dashboard.New().
        // Intro documentation
        Widget(
            widget.NewMarkdown().
                Content(`# TimeBar Widget

The TimeBar widget displays time-series data as bars.

## Basic Usage

\`\`\`go
widget.NewTimeBar().
    Title("Requests over Time").
    X("timestamp").
    Y("count").
    Height(200)
\`\`\``),
        ).

        // Basic example
        Widget(
            widget.NewTimeBar().
                Title("Basic TimeBar - Requests by Minute").
                Query(
                    sql.New().
                        From("http_logs").
                        Select(
                            sql.Timestamp15Min("timestamp", "timestamp"),
                            sql.Count("request_count"),
                        ),
                ).
                X("timestamp").
                Y("request_count").
                Height(200),
        ).

        // Stacked example
        Widget(
            widget.NewMarkdown().
                Content(`## Stacked TimeBar with Fill

Use \`.Fill()\` to stack data by categories:`),
        ).
        Widget(
            widget.NewTimeBar().
                Title("Stacked TimeBar - Requests by Status Code").
                Query(
                    sql.New().
                        From("http_logs").
                        Select(
                            sql.Timestamp15Min("timestamp", "timestamp"),
                            sql.Field("statusGroup"),
                            sql.Count("request_count"),
                        ),
                ).
                X("timestamp").
                Y("request_count").
                Fill("statusGroup").
                Color(widget.ColorMapping{
                    Domain: []string{"2xx", "3xx", "4xx", "5xx"},
                    Range:  []string{"#56AF18", "#F4C83E", "#F77C39", "#D73027"},
                }).
                Height(200),
        ).

        // Faceted example
        Widget(
            widget.NewMarkdown().
                Content(`## Faceted TimeBar

Use \`.Fx()\` or \`.Fy()\` for small multiples:`),
        ).
        Widget(
            widget.NewTimeBar().
                Title("Faceted TimeBar - Requests by Host").
                Query(
                    sql.New().
                        From("http_logs").
                        Select(
                            sql.Timestamp15Min("timestamp", "timestamp"),
                            sql.Field("hostname"),
                            sql.Count("request_count"),
                        ),
                ).
                X("timestamp").
                Y("request_count").
                Fy("hostname").
                Height(400),
        )
}
```

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

#### Task 1.1: Create New Markdown Widget
**Files:**
- `lib/dashboard/widget/markdown.go` - Main widget implementation
- `lib/components/widget_component/markdown.templ` - Template for rendering

**Requirements:**
- Clean Markdown rendering (no legacy features)
- Syntax highlighting for code blocks (Go, SQL, JavaScript, bash)
- Support both `.Content()` and `.File()` methods
- Proper CSS styling (integrate with existing DaisyUI theme)

#### Task 1.2: Create Dev Server Structure
**Files:**
- `docs/dev-server/main.go` - Main entry point
- `docs/dev-server/README.md` - How to run the dev server

**Requirements:**
- Simple `go run` command to start
- Clear instructions for setup
- Environment variables documented

### Phase 2: Widget Examples (Week 2)

#### Task 2.1: Implement Core Widget Examples
Create example files for each widget:

**Basic Widgets:**
1. ✅ `examples/widgets/time_bar_example.go` - TimeBar examples
2. ✅ `examples/widgets/bar_vertical_example.go` - BarVertical examples
3. ✅ `examples/widgets/bar_horizontal_example.go` - BarHorizontal examples
4. ✅ `examples/widgets/stats_example.go` - Stats examples

**Heatmap Widgets:**
5. ✅ `examples/widgets/time_heatmap_example.go` - TimeHeatmap examples
6. ✅ `examples/widgets/time_heatmap_ordinal_example.go` - TimeHeatmapOrdinal examples

**Layout Widgets:**
7. ✅ `examples/widgets/grid_example.go` - Grid layout examples
8. ✅ `examples/widgets/collapsible_group_example.go` - CollapsibleGroup examples

Each example should include:
- Multiple variants (basic, with color, faceted, etc.)
- Inline documentation using Markdown widget
- Working SQL queries with sample data
- Code snippets showing Go API usage

#### Task 2.2: Create Sample SQL Queries
**Files:**
- `examples/data/sample_http_logs.sql` - Sample HTTP log queries
- `examples/data/sample_metrics.sql` - Sample metric queries
- `examples/data/sample_events.sql` - Sample event queries

**Requirements:**
- Queries should work with standard ClickHouse tables
- Include setup instructions for sample data
- Document query patterns and best practices

### Phase 3: Documentation Pages (Week 2-3)

#### Task 3.1: Core Documentation
**Files:**
1. `examples/docs/introduction.go` - What is Dashica, architecture overview
2. `examples/docs/quickstart.go` - Getting started guide
3. `examples/docs/widgets_overview.go` - Overview of all widgets
4. `examples/docs/sql_builder.go` - SQL builder API documentation
5. `examples/docs/dashboard_builder.go` - Dashboard builder API docs

#### Task 3.2: Advanced Topics
**Files:**
6. `examples/docs/layouts.go` - Custom layouts and grid systems
7. `examples/docs/colors.go` - Color schemes and theming
8. `examples/docs/filters.go` - Filter buttons and interactivity
9. `examples/docs/best_practices.go` - Performance tips and patterns

### Phase 4: Advanced Examples (Week 3)

#### Task 4.1: Real-World Dashboard Examples
**Files:**
1. `examples/advanced/monitoring_dashboard.go` - Full monitoring dashboard
2. `examples/advanced/analytics_dashboard.go` - Analytics dashboard
3. `examples/advanced/error_tracking.go` - Error tracking dashboard

#### Task 4.2: Pattern Examples
**Files:**
4. `examples/advanced/multi_widget.go` - Multiple widgets on one page
5. `examples/advanced/custom_layout.go` - Custom grid layouts
6. `examples/advanced/filter_buttons.go` - Interactive filter buttons
7. `examples/advanced/color_schemes.go` - Custom color schemes

### Phase 5: Polish & Testing (Week 4)

#### Task 5.1: Visual Polish
- Ensure consistent styling across all examples
- Add navigation improvements
- Implement breadcrumbs or "back to docs" links
- Add syntax highlighting theme that matches dark/light mode

#### Task 5.2: Testing & Validation
- Test all examples with real ClickHouse data
- Verify code snippets are copy-paste ready
- Check all internal links work
- Performance test with multiple dashboards

#### Task 5.3: Documentation
- Create comprehensive README for dev server
- Document how to add new examples
- Document sample data setup
- Create troubleshooting guide

## File Structure

```
dashica/
├── lib/
│   └── dashboard/
│       └── widget/
│           ├── markdown.go              # NEW - Clean markdown widget
│           └── legacy_markdown.go       # Existing - For Observable dashboards
│
├── docs/
│   ├── dev-server/
│   │   ├── main.go                      # Dev server entry point
│   │   ├── README.md                    # How to run
│   │   ├── go.mod                       # Dependencies (if separate module)
│   │   │
│   │   ├── examples/
│   │   │   ├── widgets/                 # Widget examples
│   │   │   │   ├── time_bar_example.go
│   │   │   │   ├── bar_vertical_example.go
│   │   │   │   ├── bar_horizontal_example.go
│   │   │   │   ├── stats_example.go
│   │   │   │   ├── time_heatmap_example.go
│   │   │   │   ├── time_heatmap_ordinal_example.go
│   │   │   │   ├── grid_example.go
│   │   │   │   └── collapsible_group_example.go
│   │   │   │
│   │   │   ├── advanced/                # Advanced examples
│   │   │   │   ├── monitoring_dashboard.go
│   │   │   │   ├── analytics_dashboard.go
│   │   │   │   ├── multi_widget.go
│   │   │   │   ├── custom_layout.go
│   │   │   │   ├── filter_buttons.go
│   │   │   │   └── color_schemes.go
│   │   │   │
│   │   │   ├── docs/                    # Documentation pages
│   │   │   │   ├── introduction.go
│   │   │   │   ├── quickstart.go
│   │   │   │   ├── widgets_overview.go
│   │   │   │   ├── sql_builder.go
│   │   │   │   ├── dashboard_builder.go
│   │   │   │   ├── layouts.go
│   │   │   │   ├── colors.go
│   │   │   │   ├── filters.go
│   │   │   │   └── best_practices.go
│   │   │   │
│   │   │   └── data/                    # Sample queries
│   │   │       ├── sample_http_logs.sql
│   │   │       ├── sample_metrics.sql
│   │   │       └── sample_events.sql
│   │   │
│   │   └── static/                      # Static docs (optional)
│   │       └── markdown/                # Raw markdown files
│   │           ├── intro.md
│   │           └── architecture.md
│   │
│   ├── REWRITE_PLAN.md                  # Existing
│   └── 2026_02_06_selfhosted_docs_ai.md # This file
│
└── server/
    └── cmd/
        └── dashica-server/
            └── main.go                   # DEPRECATED - remove later
```

## Technical Specifications

### Markdown Widget API

```go
package widget

type Markdown struct {
    content string
    file    string
    title   string
}

func NewMarkdown() *Markdown

// Methods (fluent interface)
func (m *Markdown) Content(markdown string) *Markdown
func (m *Markdown) File(path string) *Markdown
func (m *Markdown) Title(title string) *Markdown

// Widget interface implementation
func (m *Markdown) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error)
func (m *Markdown) CollectHandlers(ctx *rendering.DashboardContext, collector handler_collector.HandlerCollector) error
```

**Rendering Requirements:**
- Use `goldmark` with these extensions:
  - GFM (GitHub Flavored Markdown)
  - Auto heading IDs
  - Syntax highlighting (using `chroma` or similar)
- CSS classes should use Tailwind/DaisyUI
- Prose styling: `<div class="prose prose-slate dark:prose-invert max-w-none">`

### Dev Server Configuration

**Environment Variables:**
```bash
# Required
CLICKHOUSE_HOST=localhost:9000
CLICKHOUSE_DATABASE=default
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=""

# Optional
APP_ENV=development
LOG_TO_STDOUT=true
PORT=8080
```

**Running the dev server:**
```bash
cd docs/dev-server
go run main.go

# Or with custom config
APP_ENV=development go run main.go
```

### Sample Data Setup

For the examples to work, users need sample data in ClickHouse:

```sql
-- Create sample table
CREATE TABLE IF NOT EXISTS default.http_logs (
    timestamp DateTime,
    hostname String,
    method String,
    path String,
    status UInt16,
    statusGroup String,
    response_time Float64,
    bytes_sent UInt64
) ENGINE = MergeTree()
ORDER BY timestamp;

-- Insert sample data (script provided in examples/data/)
```

**Setup script:** `examples/data/setup_sample_data.sql`

## Success Criteria

### Must Have (MVP)
- ✅ New Markdown widget implemented and working
- ✅ Dev server runs with `go run main.go`
- ✅ All 8 widget types have working examples
- ✅ At least 3 documentation pages (intro, quickstart, widgets overview)
- ✅ Sample SQL queries provided and documented
- ✅ Code highlighting works correctly
- ✅ Dark/light mode compatible

### Should Have (V1.0)
- ✅ All documentation pages complete
- ✅ Advanced examples implemented
- ✅ Sample data setup scripts
- ✅ Navigation between examples is smooth
- ✅ All code snippets are copy-paste ready
- ✅ Comprehensive README for dev server

### Nice to Have (Future)
- 🔄 Interactive code playground
- 🔄 Auto-generated API docs from Go code
- 🔄 Search functionality across docs
- 🔄 Performance benchmarks in docs
- 🔄 Video tutorials or animated examples

## Migration Path

### For Existing Users
The dev environment is **additive** - no breaking changes:
1. Existing `LegacyMarkdown` widget remains unchanged
2. New `Markdown` widget is for new documentation only
3. Dev server is optional - not required for production

### For New Users
1. Clone repository
2. Start dev server: `cd docs/dev-server && go run main.go`
3. Browse examples at http://localhost:8080
4. Copy patterns from examples to build your own dashboards

## Open Questions & Decisions Needed

### 1. Module Structure
**Question:** Should `docs/dev-server` be a separate Go module or part of main module?

**Options:**
- A) **Separate module** (`docs/dev-server/go.mod`)
  - ✅ Clean separation
  - ✅ Can have different dependency versions
  - ❌ More complex to maintain

- B) **Part of main module** (recommended)
  - ✅ Simpler structure
  - ✅ Shared dependencies
  - ✅ Easier to keep in sync
  - ❌ Dev dependencies in main module

**DECISION:** Option B - Part of main module

### 2. Sample Data Strategy
**Question:** How should users set up sample data for examples?

**Options:**
- A) **Mock data in Go** - Generate fake data programmatically
- B) **SQL setup script** - Provide SQL script to create and populate tables
- C) **Docker Compose** - Provide complete environment with pre-populated ClickHouse
- D) **All of the above**

**DECISION:** Start with B (SQL script), add C (Docker Compose) later

### 3. Syntax Highlighting

**Question:** Which library for code syntax highlighting?

**Options:**
- A) **chroma** - Go library, more control
- B) **highlight.js** - Client-side, already used in frontend
- C) **Both** - Server-side for static, client-side for dynamic

**DECISION:** Option A (chroma) for consistency and server-side rendering

### 4. Documentation Format
**Question:** Should documentation be in Go files or Markdown files loaded by Go?

**Options:**
- A) **Inline in Go** - `widget.NewMarkdown().Content("...")`
  - ✅ Type-safe, refactorable
  - ❌ Less readable for long content

- B) **Separate .md files** - `widget.NewMarkdown().File("docs/intro.md")`
  - ✅ Better for long-form content
  - ✅ Familiar format
  - ❌ Need to keep files in sync

- C) **Mixed** - Short content inline, long content in files

**DECISION:** Option C - Mixed approach based on content length, but the Go files are always the "masters"

## Next Steps

### Immediate Actions (This Session)
1. ✅ Review and iterate on this plan
2. ✅ Get user approval on architectural decisions
3. ✅ Clarify open questions above

### After Plan Approval
1. Start Phase 1: Implement Markdown widget
2. Create dev-server scaffold
3. Implement first example (TimeBar)
4. Iterate based on feedback

## Timeline Estimate

**Assuming focused development:**
- Phase 1 (Infrastructure): 2-3 days
- Phase 2 (Widget Examples): 3-4 days
- Phase 3 (Documentation): 3-4 days
- Phase 4 (Advanced Examples): 2-3 days
- Phase 5 (Polish & Testing): 2-3 days

**Total:** ~2-3 weeks of development time

## References

- `REWRITE_PLAN.md` - Overall rewrite plan and architecture
- `lib/dashboard/widget/legacy_markdown.go` - Existing markdown implementation
- `docs/src/docs/10_timeBar.md` - Example of legacy Observable dashboard docs
- `lib/dashboard/dashboard.go` - Dashboard builder API
- `dashica.go` - Main public API

---

**Status:** Ready for review and iteration
**Next:** Discuss open questions and get approval to proceed
