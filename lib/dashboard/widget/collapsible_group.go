package widget

import (
	"fmt"
	"iter"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util"
)

type CollapsibleGroup struct {
	// title is the text shown on the collapsible header.
	title string `dashica-gen:"client"`
	// widgets are the child widgets rendered inside the group, in order.
	widgets Widgets `dashica-gen:"method=Widget"`
	// open controls whether the group starts expanded. Zero value: collapsed.
	open bool `dashica-gen:"client"`
}

func NewCollapsibleGroup() *CollapsibleGroup {
	return &CollapsibleGroup{}
}

func (w *CollapsibleGroup) Title(title string) *CollapsibleGroup {
	cloned := *w
	cloned.title = title
	return &cloned
}

func (w *CollapsibleGroup) Open() *CollapsibleGroup {
	cloned := *w
	cloned.open = true
	return &cloned
}

func (w *CollapsibleGroup) Widget(widget WidgetDefinition) *CollapsibleGroup {
	cloned := *w
	cloned.widgets = append(w.widgets, widget)
	return &cloned
}

func (w *CollapsibleGroup) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	components, err := util.MapHandleError(w.widgets, func(w WidgetDefinition) (templ.Component, error) { return w.BuildComponents(ctx) })
	if err != nil {
		return nil, fmt.Errorf("collapsibleGroup: rendering widgets: %w", err)
	}

	return widget_component.CollapsibleGroup(w.title, templ.Join(components...), w.open), nil
}

func (w *CollapsibleGroup) Children() iter.Seq2[string, WidgetDefinition] { return w.widgets.all() }

var _ WidgetDefinition = (*CollapsibleGroup)(nil)
