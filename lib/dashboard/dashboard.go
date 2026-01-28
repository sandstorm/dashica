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
	FilterButton(title string, queryPart string) Dashboard
	CollectHandlers(handlerCollector handler_collector.HandlerCollector, renderingContext rendering.RenderingContext) error
}

func New() Dashboard {
	return &dashboardImpl{}
}

type dashboardImpl struct {
	widgets       widget.Widgets
	layout        rendering.LayoutFunc
	filterButtons []rendering.FilterButton
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

func (d *dashboardImpl) CollectHandlers(handlerCollector handler_collector.HandlerCollector, renderingContext rendering.RenderingContext) error {
	components, err := util.MapHandleError(d.widgets, func(w widget.WidgetDefinition) (templ.Component, error) { return w.BuildComponents(renderingContext) })
	if err != nil {
		return fmt.Errorf("building components: %w", err)
	}

	err = handlerCollector.HandleRoot(templ.Handler(d.layout(renderingContext, d.filterButtons, templ.Join(components...))))
	if err != nil {
		return fmt.Errorf("registering layout handler: %w", err)
	}
	return d.widgets.CollectHandlers(handlerCollector.Nested("/api"))
}

var _ Dashboard = &dashboardImpl{}
