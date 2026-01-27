package widget

import (
	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/util"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

type CollapsibleGroup struct {
	widgets Widgets
}

func NewCollapsibleGroup() *CollapsibleGroup {
	return &CollapsibleGroup{}
}

func (w *CollapsibleGroup) Widget(widget WidgetDefinition) *CollapsibleGroup {
	cloned := *w
	cloned.widgets = append(w.widgets, widget)
	return &cloned
}

func (w *CollapsibleGroup) Render() templ.Component {
	components := util.Map(w.widgets, func(w WidgetDefinition) templ.Component { return w.Render() })

	return widget_component.CollapsibleGroup(templ.Join(components...))
}

func (w *CollapsibleGroup) CollectHandlers(collector handler_collector.HandlerCollector) {
	w.widgets.CollectHandlers(collector)
}

var _ WidgetDefinition = (*CollapsibleGroup)(nil)
