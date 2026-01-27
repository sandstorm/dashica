package dashboard

import (
	"fmt"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
	"github.com/sandstorm/dashica/lib/util"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

type Dashboard interface {
	Widget(w widget.WidgetDefinition) Dashboard
	WithLayout(layout LayoutFunc) Dashboard
	FilterButton(title string, queryPart string) Dashboard
	CollectHandlers(handlerCollector handler_collector.HandlerCollector, dashboardExecutionCtx DashboardExecutionContext) error
}

type DashboardExecutionContext struct {
	// DashboardGroups returns the registered dashboard groups for this Dashica instance (e.g. for building a menu)
	DashboardGroups []DashboardGroup
	// current handler URL - to determine the current page
	CurrentHandlerUrl string
	FilterButtons     []FilterButton
}

type DashboardGroup struct {
	Title   string
	Entries []DashboardGroupEntry
}

type DashboardGroupEntry struct {
	Title     string
	Url       string
	Dashboard Dashboard
}

func New() Dashboard {
	return &dashboardImpl{}
}

type LayoutFunc func(dashboardExecutionContext DashboardExecutionContext, filterButtons []FilterButton, content templ.Component) templ.Component

type FilterButton struct {
	Title     string
	QueryPart string
}

type dashboardImpl struct {
	widgets       widget.Widgets
	layout        LayoutFunc
	filterButtons []FilterButton
}

func (d *dashboardImpl) Widget(w widget.WidgetDefinition) Dashboard {
	cloned := *d
	cloned.widgets = append(cloned.widgets, w)
	return &cloned
}

func (d *dashboardImpl) WithLayout(layout LayoutFunc) Dashboard {
	cloned := *d
	cloned.layout = layout
	return &cloned
}

func (d *dashboardImpl) FilterButton(title string, queryPart string) Dashboard {
	cloned := *d
	cloned.filterButtons = append(cloned.filterButtons, FilterButton{
		Title:     title,
		QueryPart: queryPart,
	})
	return &cloned
}

func (d *dashboardImpl) CollectHandlers(handlerCollector handler_collector.HandlerCollector, dashboardExecutionContext DashboardExecutionContext) error {
	components := util.Map(d.widgets, func(w widget.WidgetDefinition) templ.Component { return w.Render() })
	err := handlerCollector.HandleRoot(templ.Handler(d.layout(dashboardExecutionContext, d.filterButtons, templ.Join(components...))))
	if err != nil {
		return fmt.Errorf("registering layout handler: %w", err)
	}
	return d.widgets.CollectHandlers(handlerCollector.Nested("/widgets"))
}

var _ Dashboard = &dashboardImpl{}
