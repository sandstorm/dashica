package widget

import (
	"fmt"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

type CollapsibleGroup struct {
	title   string
	widgets Widgets
}

func NewCollapsibleGroup() *CollapsibleGroup {
	return &CollapsibleGroup{}
}

func (w *CollapsibleGroup) Title(title string) *CollapsibleGroup {
	cloned := *w
	cloned.title = title
	return &cloned
}

func (w *CollapsibleGroup) Widget(widget WidgetDefinition) *CollapsibleGroup {
	cloned := *w
	cloned.widgets = append(w.widgets, widget)
	return &cloned
}

func (w *CollapsibleGroup) BuildComponents(renderingContext rendering.DashboardContext) (templ.Component, error) {
	components, err := util.MapHandleError(w.widgets, func(w WidgetDefinition) (templ.Component, error) { return w.BuildComponents(renderingContext) })
	if err != nil {
		return nil, fmt.Errorf("collapsibleGroup: rendering widgets: %w", err)
	}

	return widget_component.CollapsibleGroup(w.title, templ.Join(components...)), nil
}

func (w *CollapsibleGroup) CollectHandlers(ctx rendering.DashboardContext, collector handler_collector.HandlerCollector) {
	w.widgets.CollectHandlers(ctx, collector)
}

var _ WidgetDefinition = (*CollapsibleGroup)(nil)
