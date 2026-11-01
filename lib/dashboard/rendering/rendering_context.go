package rendering

import (
	"io/fs"
	"strconv"

	"github.com/rs/zerolog"
	alerting2 "github.com/sandstorm/dashica/lib/alerting"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

type DashboardContext struct {
	// MainMenu returns the registered dashboard groups for this Dashica instance (e.g. for building a menu)
	MainMenu *[]MenuGroup
	// current handler URL - to determine the current page
	CurrentHandlerUrl string
	FilterButtons     []FilterButton
	// DefaultTime is the page's default time range as a Go duration ("168h"; "24h" when it declares none), the one
	// page.json carries: its widgets' handlers read a request without `time` with it (httpserver.ParseQueryState), as
	// the page's URL leaves it out.
	DefaultTime string

	// ExploreBaseURL points at the registration URL of the Explore view (e.g.
	// "/explore"), or is nil / empty when Explore is not registered. It is a
	// pointer shared across every dashboard context so it resolves at request
	// time regardless of dashboard/Explore registration order: each dashboard's
	// own open-in-explore handler redirects to it.
	//
	// Deprecated: (workbench) Explore's Go API, kept for its rebuild on the workbench; see docs/2026-10-28-workbench.md §5.
	ExploreBaseURL *string

	Deps Dependencies

	// UntrustedContent marks a render whose widget definitions come from an
	// untrusted author rather than compiled-in Go — i.e. a dashboard built or
	// stored via the Explore view. Widgets that emit author-controlled HTML (the
	// markdown widget) MUST render in a safe mode when this is set: compiled
	// markdown is trusted and may embed raw HTML, but Explore-authored markdown
	// is shown to other viewers and would otherwise be a stored-XSS vector (see
	// docs/2026-07-21-dynamic-widget-dashboard-ui.md §6). The zero value (false)
	// keeps every existing compiled dashboard fully trusted.
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

type Dependencies struct {
	ClickhouseClientManager *clickhouse.Manager
	Logger                  zerolog.Logger
	TimeProvider            config.TimeProvider
	FileSystem              fs.ReadFileFS
	AlertResultStore        *alerting2.AlertResultStore
	AlertEvaluator          *alerting2.AlertEvaluator
	AlertManager            *alerting2.AlertManager
	// Config is the loaded dashica_config, read only. The handlers check its settings where they apply: explore.enabled
	// in the Explore handlers (httpserver.ErrExploreNotEnabled), filters.sqlEnabled where SQL chips enter a query
	// (httpserver.QueryState.SqlClause), filters.secret where pills are signed and opened (filter.Sign, filter.Open).
	Config *config.Config
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
	// Id is the last part of its dataUrl ("3" of "/p/shop/api/3"); the link "/p/shop#w=3" shows it.
	Id    string `json:"id"`
	Title string `json:"title"`
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
	// Key is, in page.json, the signed pill of a button without `...` (filter.Sign), which pressing it puts into the
	// URL; empty for one with.
	Key string `json:"key,omitempty"`
	// Url is, in page.json, where a button with `...` gets its pill for a value: `<page>/button?i=<index>`, the value
	// appended as `&value=<value>`, answered as `{key, label}`; empty for one without.
	Url string `json:"url,omitempty"`
}

type SearchBarOption struct {
	IsVisible     bool
	FilterButtons []FilterButton
}
