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

type Stats struct {
	sql        sql.SqlQueryable
	titleField *sql.SqlField
	fillField  *sql.SqlField
	id         string
}

func (s *Stats) TitleField(field sql.SqlField) *Stats {
	cloned := *s
	cloned.titleField = &field
	return &cloned
}

func (s *Stats) FillField(field sql.SqlField) *Stats {
	cloned := *s
	cloned.fillField = &field
	return &cloned
}

func (s *Stats) Id(id string) *Stats {
	cloned := *s
	cloned.id = id
	return &cloned
}

func (s *Stats) AdjustQuery(opts ...sql.SqlBuilderOption) *Stats {
	cloned := *s
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func NewStats(sql sql.SqlQueryable) *Stats {
	return &Stats{
		sql: sql,
	}
}

func (s *Stats) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	if len(s.id) == 0 {
		s.id = ctx.NextWidgetId()
	}

	chartProps := s.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("stats: failed to marshal chart props: %w", err)
	}

	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+s.id, "stats", string(chartPropsJSON), 0), nil
}

func (s *Stats) buildChartProps() map[string]interface{} {
	props := make(map[string]interface{})

	// Optional fields
	if s.titleField != nil {
		props["title"] = (*s.titleField).Alias()
	}
	if s.fillField != nil {
		props["fill"] = (*s.fillField).Alias()
	}

	return props
}

func (s *Stats) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(s.id) == 0 {
		s.id = ctx.NextWidgetId()
	}

	// Build the SQL query - select all stat fields
	query := s.sql
	// Add optional fields
	if s.titleField != nil {
		query = query.With(sql.Select(*s.titleField))
	}
	if s.fillField != nil {
		query = query.With(sql.Select(*s.fillField))
	}

	return RegisterQueryHandlers(s.id, "stats", query, ctx, registerHandler)
}

var _ InteractiveWidget = (*Stats)(nil)
