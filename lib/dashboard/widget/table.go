package widget

import (
	"encoding/json"
	"fmt"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util/handler_collector"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type Table struct {
	sql    sql.SqlQueryable
	title  string
	id     string
	height int
	limit  int
}

func NewTable(sql sql.SqlQueryable) *Table {
	return &Table{
		sql:    sql,
		height: 200,
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
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	chartProps := b.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("table: failed to marshal chart props: %w", err)
	}

	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+b.id, "table", string(chartPropsJSON)), nil
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

func (b *Table) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	// Build the SQL query
	query := b.sql.With(
		sql.Limit(b.limit),
	/*sql.PrependSelect(b.x),
	sql.GroupBy(b.x),
	sql.Select(b.y),*/
	)

	return RegisterQueryHandlers(b.id, "table", query, ctx, registerHandler)
}

var _ InteractiveWidget = (*Table)(nil)
