// Package explore implements the on-demand Dashica query/widget builder — the
// "Explore" view described in docs/2026-07-21-dynamic-widget-dashboard-ui.md.
//
// explore.New() returns a dashboard.Dashboard, so it plugs into the existing
// RegisterDashboard mechanism unchanged. Its CollectHandlers registers the
// editor page (root) plus the API sub-routes under "/api" (preview, formmodel,
// schema, values). net/http's trailing-slash subtree matching dispatches every
// request under the registration URL.
//
// Phase 2 (this file + handlers.go, preview.go, schema.go, values.go) is the
// server-side runtime: it executes a JSON-described widget and serves the raw
// material the (Phase 4) editor UI needs. Persistence (WithFileStore) is Phase 6.
package explore

import (
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// Option configures an Explore instance. Persistence options (WithFileStore,
// WithReadOnly) arrive in Phase 6; the variadic signature is stable now so
// call sites in main.go do not change when they land.
type Option func(*exploreImpl)

// New creates an Explore view. Wire it up in main.go exactly like a dashboard:
//
//	d.RegisterDashboardGroup("Explore").
//	    RegisterDashboard("/explore", explore.New())
func New(opts ...Option) dashboard.Dashboard {
	e := &exploreImpl{title: "Explore"}
	for _, opt := range opts {
		opt(e)
	}
	return e
}

// exploreImpl implements dashboard.Dashboard. Unlike a standard dashboard it
// holds no widget list — its page is the editor, and the widgets it renders
// arrive at request time as JSON. It satisfies the (small) Dashboard interface
// with just Title + CollectHandlers; the fluent builder API does not apply.
type exploreImpl struct {
	title string

	// Captured at CollectHandlers time so the API handler closures can build
	// per-request child contexts (see preview.go). deps carries the ClickHouse
	// manager, logger and projectFS; baseURL is the registration URL (e.g.
	// "/explore"); mainMenu is the shared boot-time menu slice.
	deps     rendering.Dependencies
	baseURL  string
	mainMenu *[]rendering.MenuGroup
}

func (e *exploreImpl) Title() string { return e.title }

func (e *exploreImpl) CollectHandlers(ctx *rendering.DashboardContext, collector handler_collector.HandlerCollector) error {
	e.deps = ctx.Deps
	e.baseURL = ctx.CurrentHandlerUrl
	e.mainMenu = ctx.MainMenu
	return e.registerHandlers(collector)
}

var _ dashboard.Dashboard = (*exploreImpl)(nil)
