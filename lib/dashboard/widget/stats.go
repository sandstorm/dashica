package widget

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type Stats struct {
	// sql is the underlying query builder; adjust it with AdjustQuery. Each
	// result row renders as one stat, using its "label" and "value" columns.
	sql sql.SqlQueryable
	// titleField overrides the per-row "label" column with a fixed title used
	// for every stat. Zero value: each row's "label" column is used.
	titleField *sql.SqlField `dashica-gen:"client,role=dimension"`
	// fillField selects a column giving each stat's text color as a CSS color
	// string. Zero value: a row's own "color" column, or the default color.
	fillField *sql.SqlField `dashica-gen:"client,role=measure"`
	// id is the stable widget id (its URL "<page>/api/<id>"); assigned by the page when empty.
	id string
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
	chartProps := s.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("stats: failed to marshal chart props: %w", err)
	}

	return chartComponent(ctx, s, "stats", string(chartPropsJSON), 0), nil
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

func (s *Stats) Handler(deps rendering.Dependencies) http.Handler {
	// Build the SQL query - select all stat fields
	query := s.sql
	// Add optional fields
	if s.titleField != nil {
		query = query.With(sql.Select(*s.titleField))
	}
	if s.fillField != nil {
		query = query.With(sql.Select(*s.fillField))
	}

	return queryHandler(deps, query)
}

func (s *Stats) explicitId() string { return s.id }

var _ WidgetDefinition = (*Stats)(nil)
