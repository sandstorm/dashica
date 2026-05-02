package dashboard

import (
	"fmt"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
	"github.com/sandstorm/dashica/lib/util"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

type Dashboard interface {
	Widget(w widget.WidgetDefinition) Dashboard
	WithLayout(layout rendering.LayoutFunc) Dashboard
	WithTitle(title string) Dashboard
	Title() string
	FilterButton(title string, queryPart string) Dashboard
	CollectHandlers(ctx *rendering.DashboardContext, handlerCollector handler_collector.HandlerCollector) error
}

func New() Dashboard {
	return &dashboardImpl{}
}

type dashboardImpl struct {
	widgets       widget.Widgets
	layout        rendering.LayoutFunc
	title         string
	filterButtons []rendering.FilterButton
}

func (d *dashboardImpl) WithTitle(title string) Dashboard {
	cloned := *d
	cloned.title = title
	return &cloned
}

func (d *dashboardImpl) Title() string {
	return d.title
}

func (d *dashboardImpl) Widget(w widget.WidgetDefinition) Dashboard {
	cloned := *d
	cloned.widgets = append(cloned.widgets, w)
	return &cloned
}

func (d *dashboardImpl) WithLayout(layout rendering.LayoutFunc) Dashboard {
	cloned := *d
	cloned.layout = layout
	return &cloned
}

func (d *dashboardImpl) FilterButton(title string, queryPart string) Dashboard {
	cloned := *d
	cloned.filterButtons = append(cloned.filterButtons, rendering.FilterButton{
		Title:     title,
		QueryPart: queryPart,
	})
	return &cloned
}

func (d *dashboardImpl) CollectHandlers(ctx *rendering.DashboardContext, handlerCollector handler_collector.HandlerCollector) error {
	components, err := util.MapHandleError(d.widgets, func(w widget.WidgetDefinition) (templ.Component, error) { return w.BuildComponents(ctx) })
	if err != nil {
		return fmt.Errorf("building components: %w", err)
	}

	err = handlerCollector.HandleRoot(templ.Handler(d.layout(*ctx, d.filterButtons, templ.Join(components...))))
	if err != nil {
		return fmt.Errorf("registering layout handler: %w", err)
	}
	return d.widgets.CollectHandlers(ctx, handlerCollector.Nested("/api"))
}

var _ Dashboard = &dashboardImpl{}
