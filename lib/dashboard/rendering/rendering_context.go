package rendering

import (
	"io/fs"

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

	Deps Dependencies
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

type LayoutFunc func(renderingContext DashboardContext, filterButtons []FilterButton, content templ.Component) templ.Component
