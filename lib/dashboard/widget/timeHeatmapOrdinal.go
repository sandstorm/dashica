package widget

import (
	"encoding/json"
	"fmt"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util/handler_collector"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type TimeHeatmapOrdinal struct {
	// sql is the underlying query builder; adjust it with AdjustQuery.
	sql sql.SqlQueryable
	// x is the timestamped time-axis field, bucketed by xBucketSize.
	x sql.TimestampedField
	// y is the ordinal (categorical) field plotted as one row per distinct value.
	y sql.SqlField `dashica-gen:"role=dimension"`
	// fill is the measure bound to the color scale, coloring each cell.
	// Zero value: cells are colored by Observable Plot's default scheme.
	fill *sql.SqlField `dashica-gen:"role=measure"`
	// title is the chart title shown above the plot.
	title string
	// id is the stable widget id; assigned automatically when empty.
	id string
	// height is the chart height in pixels. Zero value: Observable Plot's default.
	height *int
	// width is the chart width in pixels. Zero value: fills the container width.
	width *int
	// marginLeft is the left margin in pixels. Zero value: Observable Plot's default.
	marginLeft *int
	// colorScheme names an Observable Plot color scheme for the fill scale
	// (e.g. "blues", "inferno"). Zero value: the dashboard's default
	// light/dark scheme. Ignored when color is set.
	// Docs: https://observablehq.com/plot/features/scales#color-scales
	colorScheme string
	// color configures the color scale used for fill; takes precedence over colorScheme.
	color *color.ColorScale
	// xBucketSize is the width of each time bucket on the x axis, in milliseconds.
	xBucketSize int64
	// yBucketSize is sent to the API but not used by the ordinal heatmap's
	// rendering, since rows are one per distinct y value rather than bucketed.
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

	heightVal := 0
	if h.height != nil {
		heightVal = *h.height
	}
	return chartComponent(ctx, h, h.id, "timeHeatmapOrdinal", string(chartPropsJSON), heightVal), nil
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
	return RegisterQueryHandlers(h.id, "timeHeatmapOrdinal", query, ctx, registerHandler)
}

var _ InteractiveWidget = (*TimeHeatmapOrdinal)(nil)
