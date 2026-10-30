package widget

import (
	"iter"
)

type Grid struct {
	// template is the CSS grid-template-areas rows, set via Template(); each
	// string is one row of space-separated area names.
	template []string `dashica-gen:"client"`
	// areas maps area name to the widget rendered in that area, set via Area().
	areas WidgetsMap `dashica-gen:"method=Area"`
	// gap is the spacing between grid items (Tailwind spacing scale). Zero
	// value from NewGrid(): "4px".
	gap string `dashica-gen:"client"`
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

func (g *Grid) Children() iter.Seq2[string, WidgetDefinition] { return g.areas.all() }
