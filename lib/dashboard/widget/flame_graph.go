package widget

import (
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// FlameGraph draws a profile as an interactive flame graph. Its query returns one row per call stack: `stack`, the
// frames root first separated by ";" (Excimer's collapsed format without the count), and `value`, its samples.
type FlameGraph struct {
	// sql is the underlying query builder; adjust it with AdjustQuery. It returns the columns "stack" and "value".
	sql sql.SqlQueryable
	// title is the flame graph's title shown above the widget.
	title string `dashica-gen:"client"`
	// height is the most the flame graph takes in pixels before it scrolls; in full screen, the screen's.
	height int `dashica-gen:"client"`
	// id is the stable widget id (its URL "<page>/api/<id>"); assigned by the page when empty.
	id string
}

func NewFlameGraph(sql sql.SqlQueryable) *FlameGraph {
	return &FlameGraph{
		sql:    sql,
		height: 800,
	}
}

func (f *FlameGraph) Title(title string) *FlameGraph {
	cloned := *f
	cloned.title = title
	return &cloned
}

func (f *FlameGraph) Height(height int) *FlameGraph {
	cloned := *f
	cloned.height = height
	return &cloned
}

func (f *FlameGraph) Id(id string) *FlameGraph {
	cloned := *f
	cloned.id = id
	return &cloned
}

func (f *FlameGraph) AdjustQuery(opts ...sql.SqlBuilderOption) *FlameGraph {
	cloned := *f
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func (f *FlameGraph) Query() sql.SqlQueryable { return f.sql }

func (f *FlameGraph) explicitId() string { return f.id }
