package widget

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/util/handler_collector"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type TimeHeatmapOrdinal struct {
	sql         sql.SqlQueryable
	x           sql.TimestampedField
	y           sql.SqlField
	fill        *sql.SqlField
	title       string
	id          string
	height      *int
	width       *int
	marginLeft  *int
	colorScheme string
	color       *color.ColorScale
	xBucketSize int64
	yBucketSize int64
}

func (h *TimeHeatmapOrdinal) X(xField sql.TimestampedField) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.x = xField
	return &cloned
}

func (h *TimeHeatmapOrdinal) Y(yField sql.SqlField) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.y = yField
	return &cloned
}

func (h *TimeHeatmapOrdinal) Fill(fillField sql.SqlField) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.fill = &fillField
	return &cloned
}

func (h *TimeHeatmapOrdinal) Title(title string) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.title = title
	return &cloned
}

func (h *TimeHeatmapOrdinal) Id(id string) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.id = id
	return &cloned
}

func (h *TimeHeatmapOrdinal) Height(height int) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.height = &height
	return &cloned
}

func (h *TimeHeatmapOrdinal) Width(width int) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.width = &width
	return &cloned
}

func (h *TimeHeatmapOrdinal) MarginLeft(margin int) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.marginLeft = &margin
	return &cloned
}

func (h *TimeHeatmapOrdinal) ColorScheme(scheme string) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.colorScheme = scheme
	return &cloned
}

func (h *TimeHeatmapOrdinal) Color(opts ...color.ColorScaleOption) *TimeHeatmapOrdinal {
	cloned := *h
	if cloned.color == nil {
		cloned.color = color.New()
	}
	cloned.color = cloned.color.With(opts...)
	return &cloned
}

func (h *TimeHeatmapOrdinal) XBucketSize(size int64) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.xBucketSize = size
	return &cloned
}

func (h *TimeHeatmapOrdinal) YBucketSize(size int64) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.yBucketSize = size
	return &cloned
}

func (h *TimeHeatmapOrdinal) AdjustQuery(opts ...sql.SqlBuilderOption) *TimeHeatmapOrdinal {
	cloned := *h
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func NewTimeHeatmapOrdinal(sql *sql.SqlQuery) *TimeHeatmapOrdinal {
	return &TimeHeatmapOrdinal{
		sql: sql,
	}
}

func (h *TimeHeatmapOrdinal) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	if len(h.id) == 0 {
		h.id = ctx.NextWidgetId()
	}

	chartProps := h.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("timeHeatmapOrdinal: failed to marshal chart props: %w", err)
	}

	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+h.id, "timeHeatmapOrdinal", string(chartPropsJSON)), nil
}

func (h *TimeHeatmapOrdinal) buildChartProps() map[string]interface{} {
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
	if h.colorScheme != "" {
		props["color"] = map[string]string{"scheme": h.colorScheme}
	}
	if h.color != nil {
		props["color"] = h.color
	}

	return props
}

func (h *TimeHeatmapOrdinal) buildQuery() sql.SqlQueryable {
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

func (h *TimeHeatmapOrdinal) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(h.id) == 0 {
		h.id = ctx.NextWidgetId()
	}

	query := h.buildQuery()

	qh := httpserver.QueryHandler{
		ClickhouseClientManager: ctx.Deps.ClickhouseClientManager,
		Logger:                  ctx.Deps.Logger,
		FileSystem:              ctx.Deps.FileSystem,
	}
	err := registerHandler.Handle(h.id+"/query", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := qh.HandleQuery(query, w, r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	}))
	if err != nil {
		return fmt.Errorf("timeHeatmapOrdinal: %w", err)
	}
	return nil
}

var _ InteractiveWidget = (*TimeHeatmapOrdinal)(nil)
