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

type TimeHeatmap struct {
	sql         sql.SqlQueryable
	x           sql.TimestampedField
	y           sql.SqlField
	fill        *sql.SqlField
	title       string
	id          string
	height      *int
	width       *int
	marginLeft  *int
	yBucketSize int64
}

func (h *TimeHeatmap) X(xField sql.TimestampedField) *TimeHeatmap {
	cloned := *h
	cloned.x = xField
	return &cloned
}

func (h *TimeHeatmap) Y(yField sql.SqlField) *TimeHeatmap {
	cloned := *h
	cloned.y = yField
	return &cloned
}

func (h *TimeHeatmap) Fill(fillField sql.SqlField) *TimeHeatmap {
	cloned := *h
	cloned.fill = &fillField
	return &cloned
}

func (h *TimeHeatmap) Title(title string) *TimeHeatmap {
	cloned := *h
	cloned.title = title
	return &cloned
}

func (h *TimeHeatmap) Id(id string) *TimeHeatmap {
	cloned := *h
	cloned.id = id
	return &cloned
}

func (h *TimeHeatmap) Height(height int) *TimeHeatmap {
	cloned := *h
	cloned.height = &height
	return &cloned
}

func (h *TimeHeatmap) Width(width int) *TimeHeatmap {
	cloned := *h
	cloned.width = &width
	return &cloned
}

func (h *TimeHeatmap) MarginLeft(margin int) *TimeHeatmap {
	cloned := *h
	cloned.marginLeft = &margin
	return &cloned
}

func (h *TimeHeatmap) YBucketSize(size int64) *TimeHeatmap {
	cloned := *h
	cloned.yBucketSize = size
	return &cloned
}

func (h *TimeHeatmap) AdjustQuery(opts ...sql.SqlBuilderOption) *TimeHeatmap {
	cloned := *h
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func NewTimeHeatmap(sql *sql.SqlQuery) *TimeHeatmap {
	return &TimeHeatmap{
		sql: sql,
	}
}

func (h *TimeHeatmap) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	if len(h.id) == 0 {
		h.id = ctx.NextWidgetId()
	}

	if h.yBucketSize <= 0 {
		return nil, fmt.Errorf("timeHeatmap: YBucketSize must be set to a positive value (was %d)", h.yBucketSize)
	}

	chartProps := h.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("timeHeatmap: failed to marshal chart props: %w", err)
	}

	heightVal := 0
	if h.height != nil {
		heightVal = *h.height
	}
	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+h.id, "timeHeatmap", string(chartPropsJSON), heightVal), nil
}

func (h *TimeHeatmap) buildChartProps() map[string]interface{} {
	props := make(map[string]interface{})

	// Required fields
	props["x"] = h.x.Alias()
	props["xBucketSize"] = h.x.XBucketSizeMs()
	props["y"] = h.y.Alias()
	props["yBucketSize"] = h.yBucketSize

	// Optional fields
	if h.title != "" {
		props["title"] = h.title
	}
	if h.height != nil {
		props["height"] = *h.height
	}
	if h.width != nil {
		props["width"] = *h.width
	}
	if h.marginLeft != nil {
		props["marginLeft"] = *h.marginLeft
	}
	if h.fill != nil {
		props["fill"] = (*h.fill).Alias()
	}

	return props
}

func (h *TimeHeatmap) buildQuery() sql.SqlQueryable {
	// Build the SQL query
	query := h.sql.With(
		sql.PrependSelect(h.x),
		sql.GroupBy(h.x),
		sql.PrependSelect(h.y),
		sql.GroupBy(h.y),
		sql.OrderBy(h.x),
		sql.OrderBy(h.y),
	)

	if h.fill != nil {
		query = query.With(
			sql.Select(*h.fill),
		)
	}

	return query
}

func (h *TimeHeatmap) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(h.id) == 0 {
		h.id = ctx.NextWidgetId()
	}

	query := h.buildQuery()
	return RegisterQueryHandlers(h.id, "timeHeatmap", query, ctx, registerHandler)
}

var _ InteractiveWidget = (*TimeHeatmap)(nil)
