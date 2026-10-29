package widget

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type Table struct {
	// sql is the underlying query builder; adjust it with AdjustQuery. Columns
	// are taken as-is from the query result, one column per table column.
	sql sql.SqlQueryable
	// title is the table title shown above the widget.
	title string `dashica-gen:"client"`
	// id is the stable widget id (its URL "<page>/api/<id>"); assigned by the page when empty.
	id string
	// height is the table height in pixels.
	height int `dashica-gen:"client"`
	// limit caps the number of rows fetched via a SQL LIMIT clause.
	limit int `dashica-gen:"client"`
}

func NewTable(sql sql.SqlQueryable) *Table {
	return &Table{
		sql:    sql,
		height: 500,
		limit:  10000,
	}
}

func (b *Table) Title(title string) *Table {
	cloned := *b
	cloned.title = title
	return &cloned
}

func (b *Table) Id(id string) *Table {
	cloned := *b
	cloned.id = id
	return &cloned
}

func (b *Table) Height(height int) *Table {
	cloned := *b
	cloned.height = height
	return &cloned
}

func (b *Table) Limit(limit int) *Table {
	cloned := *b
	cloned.limit = limit
	return &cloned
}

func (b *Table) AdjustQuery(opts ...sql.SqlBuilderOption) *Table {
	cloned := *b
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func (b *Table) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	chartProps := b.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("table: failed to marshal chart props: %w", err)
	}

	return chartComponent(ctx, b, "table", string(chartPropsJSON), b.height), nil
}

func (b *Table) buildChartProps() map[string]interface{} {
	props := make(map[string]interface{})

	// Required fields
	props["height"] = b.height

	// Optional fields
	if b.title != "" {
		props["title"] = b.title
	}

	return props
}

func (b *Table) Handler(deps rendering.Dependencies) http.Handler {
	// Build the SQL query
	query := b.sql.With(
		sql.Limit(b.limit),
	)

	return queryHandler(deps, query)
}

func (b *Table) explicitId() string { return b.id }

var _ WidgetDefinition = (*Table)(nil)
