// DEPRECATED (workbench): Explore's Go API, kept for its rebuild on the workbench; its UI is gone. Port into the rebuild or delete, then remove this line. See docs/2026-10-28-workbench.md §5.

// Package explore implements the on-demand Dashica query/widget builder — the
// "Explore" view described in docs/2026-07-21-dynamic-widget-dashboard-ui.md.
//
// explore.New() returns a dashboard.Dashboard, so it plugs into the existing
// RegisterDashboard mechanism unchanged. Its CollectHandlers registers the
// editor page (root) plus the API sub-routes under "/api" (formmodel, gocode),
// which run no query. net/http's trailing-slash subtree matching dispatches every
// request under the registration URL.
//
// Deprecated: (workbench) Explore's Go API, kept for its rebuild on the workbench; see docs/2026-10-28-workbench.md §5.
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
// holds no widget list — its page is the editor (until the rebuild the
// "Explore is being rebuilt" notice). It satisfies the (small) Dashboard interface
// with just Title + CollectHandlers; the fluent builder API does not apply.
type exploreImpl struct {
	title string
}

func (e *exploreImpl) Title() string { return e.title }

// IsExploreView marks this dashboard as the Explore editor so the Dashica
// registrar records its URL (used to wire up "Open in Explore" on every
// compiled dashboard). See DashicaImpl.RegisterDashboard.
func (e *exploreImpl) IsExploreView() bool { return true }

func (e *exploreImpl) CollectHandlers(ctx *rendering.DashboardContext, collector handler_collector.HandlerCollector) (dashboard.PageJson, error) {
	page, err := rebuildNotice.CollectHandlers(ctx, collector)
	if err != nil {
		return dashboard.PageJson{}, err
	}
	return page, e.registerHandlers(collector)
}

var _ dashboard.Dashboard = (*exploreImpl)(nil)
