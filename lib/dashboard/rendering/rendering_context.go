package rendering

import (
	"io/fs"
	"strconv"

	"github.com/rs/zerolog"
	alerting2 "github.com/sandstorm/dashica/lib/alerting"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// DashboardContext is what a dashboard's CollectHandlers mounts its page with: the page's URL, the services
// (Deps), and the data URL of each widget once WidgetHandlers mounted it. Dashica makes one per registered dashboard.
type DashboardContext struct {
	// MainMenu is the registered dashboard groups of this Dashica.
	MainMenu *[]MenuGroup
	// CurrentHandlerUrl is the page's URL ("/p/shop").
	CurrentHandlerUrl string
	FilterButtons     []FilterButton

	// ExploreBaseURL points at the registration URL of the Explore view ("/explore"); nil or empty without one. Every
	// dashboard context shares the pointer, so each dashboard's open-in-explore handler finds it at request time,
	// whatever the registration order.
	//
	// Deprecated: (workbench) Explore's Go API, kept for its rebuild on the workbench; see docs/2026-10-28-workbench.md §5.
	ExploreBaseURL *string

	Deps Dependencies

	// UntrustedContent marks a render whose widget definitions come from an untrusted author: a dashboard built or
	// stored via the Explore view. Widgets that emit author-controlled HTML (the markdown widget) MUST then render in a
	// safe mode, because such markdown is shown to other viewers (a stored-XSS vector). False, the default, is a
	// compiled dashboard: trusted, its markdown may embed raw HTML.
	UntrustedContent bool

	nextWidgetId int
	dataURLs     map[any]string
}

// WidgetHandlers is where `widget` registers its handlers: below `api` ("<page>/api") at `id`, or at the page's next
// number ("1", "2", …) when `id` is empty. From then on DataURL names that URL.
func (c *DashboardContext) WidgetHandlers(api handler_collector.HandlerCollector, widget any, id string) handler_collector.HandlerCollector {
	if id == "" {
		c.nextWidgetId++
		id = strconv.Itoa(c.nextWidgetId)
	}
	handlers := api.Nested("/" + id)
	if c.dataURLs == nil {
		c.dataURLs = map[any]string{}
	}
	c.dataURLs[widget] = handlers.Path()
	return handlers
}

// DataURL is the URL below which `widget`'s handlers are ("/p/shop/api/3"), as WidgetHandlers gave them; empty for
// a widget without handlers.
func (c *DashboardContext) DataURL(widget any) string {
	return c.dataURLs[widget]
}

// Dependencies are the long-lived services and the loaded config the handlers need; nothing request-specific.
type Dependencies struct {
	ClickhouseClientManager *clickhouse.Manager
	Logger                  zerolog.Logger
	TimeProvider            config.TimeProvider
	FileSystem              fs.ReadFileFS
	AlertResultStore        *alerting2.AlertResultStore
	AlertEvaluator          *alerting2.AlertEvaluator
	AlertManager            *alerting2.AlertManager
	// Config is the loaded dashica_config, read only. The handlers check its settings where they apply: explore_enabled
	// in the Explore handlers (httpserver.ErrExploreNotEnabled), sql_filter_enabled where SQL chips enter a query
	// (httpserver.QueryState.SqlClause).
	Config *config.Config
	// FilterService signs and opens the pills and names their tables, with app_secret and the connections'
	// databases from Config.
	FilterService *filter.FilterService
}

// MenuGroup is a group of the dashboards menu ("Shop"), as RegisterDashboardGroup starts it.
type MenuGroup struct {
	Title   string           `json:"title"`
	Entries []MenuGroupEntry `json:"entries"`
}

// MenuGroupEntry is a dashboard in the menu: its title, URL ("/p/shop") and outline.
type MenuGroupEntry struct {
	Title string `json:"title"`
	Url   string `json:"url"`
	// Outline is its charts, as search everywhere finds them.
	Outline []OutlineEntry `json:"outline"`
}

// OutlineEntry is a chart in a page's outline: a widget with data and a title.
type OutlineEntry struct {
	// DataUrl is where its data is served ("/p/shop/api/3"); its last part is its id, which the link "/p/shop#w=3"
	// shows.
	DataUrl string `json:"dataUrl"`
	// RowsUrl is where it serves its rows ("/p/shop/api/3/rows"), as its node in page.json; empty for a widget without a
	// query (an alert overview), which "Explore (from chart…)" leaves out.
	RowsUrl string `json:"rowsUrl,omitempty"`
	Title   string `json:"title"`
	// Group is the title of the collapsible group around it; empty outside one.
	Group string `json:"group"`
}

// FilterButton is a button of the filter bar that adds its condition to the filter, as a signed pill
// (filter.NewButton).
type FilterButton struct {
	Title string `json:"title"`
	// QueryPart is the SQL condition the button adds to the filter ("status >= 500"); a `...` in it is the value the
	// viewer is asked for ("duration_ms >= ..."), written in as a string literal.
	QueryPart string `json:"queryPart"`
	// Key is, in page.json, the signed pill of a button without `...` (filter.FilterService.Sign), which pressing it
	// puts into the URL; empty for one with.
	Key string `json:"key,omitempty"`
	// Url is, in page.json, where a button with `...` gets its pill for a value: `<page>/button?i=<index>`, the value
	// appended as `&value=<value>`, answered as `{key, label}`; empty for one without.
	Url string `json:"url,omitempty"`
}

// SearchBarOption is a dashboard's filter bar: whether it shows, and its buttons.
type SearchBarOption struct {
	IsVisible     bool
	FilterButtons []FilterButton
}
