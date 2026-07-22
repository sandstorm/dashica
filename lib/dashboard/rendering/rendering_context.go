package rendering

import (
	"io/fs"
	"strconv"

	"github.com/a-h/templ"
	"github.com/rs/zerolog"
	alerting2 "github.com/sandstorm/dashica/lib/alerting"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
)

type DashboardContext struct {
	// MainMenu returns the registered dashboard groups for this Dashica instance (e.g. for building a menu)
	MainMenu *[]MenuGroup
	// current handler URL - to determine the current page
	CurrentHandlerUrl string
	FilterButtons     []FilterButton

	// ExploreBaseURL points at the registration URL of the Explore view (e.g.
	// "/explore"), or is nil / empty when Explore is not registered. It is a
	// pointer shared across every dashboard context so it resolves at request
	// time regardless of dashboard/Explore registration order: the page layout
	// renders the "Open in Explore" link only when it is set, and each
	// dashboard's own open-in-explore handler redirects to it.
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

	// PreviewBaseUrl, when non-empty, marks this render as an Explore preview
	// (POST /api/preview/render). Leaf chart widgets then embed their OWN
	// serialized envelope onto the chart element (data-preview-base /
	// data-preview-body) so each chart — nested at any depth — knows to fetch
	// its data by POSTing that envelope to <PreviewBaseUrl>/query instead of
	// GETting a per-widget handler URL that Explore never mounts. The zero value
	// (empty) is a compiled dashboard: charts fetch via their widget handler URL
	// and the preview attributes are absent (byte-identical output).
	PreviewBaseUrl string

	nextWidgetId int
}

func (c *DashboardContext) NextWidgetId() string {
	c.nextWidgetId++
	return strconv.Itoa(c.nextWidgetId)
}

type Dependencies struct {
	ClickhouseClientManager *clickhouse.Manager
	Logger                  zerolog.Logger
	TimeProvider            config.TimeProvider
	FileSystem              fs.ReadFileFS
	AlertResultStore        *alerting2.AlertResultStore
	AlertEvaluator          *alerting2.AlertEvaluator
	AlertManager            *alerting2.AlertManager
}

type MenuGroup struct {
	Title   string
	Entries []MenuGroupEntry
}

type MenuGroupEntry struct {
	Title string
	Url   string
}

type FilterButton struct {
	Title     string
	QueryPart string
}

type SearchBarOption struct {
	IsVisible     bool
	FilterButtons []FilterButton
}

type LayoutFunc func(renderingContext DashboardContext, searchBar SearchBarOption, content templ.Component) templ.Component
