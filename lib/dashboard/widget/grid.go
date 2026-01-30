package widget

import (
	"fmt"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

type Grid struct {
	template []string
	areas    WidgetsMap
	gap      string
}

func NewGrid() *Grid {
	return &Grid{
		areas: make(map[string]WidgetDefinition),
		gap:   "4px",
	}
}

// Template sets the grid layout using CSS grid-template-areas notation
// Each string represents a row, with space-separated area names
func (g *Grid) Template(rows ...string) *Grid {
	cloned := *g
	cloned.template = rows
	cloned.areas = make(map[string]WidgetDefinition)
	for k, v := range g.areas {
		cloned.areas[k] = v
	}
	return &cloned
}

// Area assigns a widget to a named grid area
func (g *Grid) Area(name string, widget WidgetDefinition) *Grid {
	cloned := *g
	cloned.areas = make(map[string]WidgetDefinition)
	for k, v := range g.areas {
		cloned.areas[k] = v
	}
	cloned.areas[name] = widget
	return &cloned
}

// Gap sets the gap between grid items (Tailwind spacing scale)
func (g *Grid) Gap(gap string) *Grid {
	cloned := *g
	cloned.gap = gap
	return &cloned
}

func (g *Grid) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	areaComponents := make(map[string]templ.Component)

	for name, widget := range g.areas {
		component, err := widget.BuildComponents(ctx)
		if err != nil {
			return nil, fmt.Errorf("grid: rendering area '%s': %w", name, err)
		}
		areaComponents[name] = component
	}

	return widget_component.Grid(g.template, g.gap, areaComponents), nil
}

func (g *Grid) CollectHandlers(ctx *rendering.DashboardContext, collector handler_collector.HandlerCollector) error {
	return g.areas.CollectHandlers(ctx, collector)
}

var _ WidgetDefinition = (*Grid)(nil)
