package widget

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type TimeHeatmapOrdinal struct {
	// sql is the underlying query builder; adjust it with AdjustQuery.
	sql sql.SqlQueryable
	// x is the timestamped time-axis field, bucketed by xBucketSize.
	x sql.TimestampedField `dashica-gen:"client"`
	// y is the ordinal (categorical) field plotted as one row per distinct value.
	y sql.SqlField `dashica-gen:"client,role=dimension"`
	// fill is the measure bound to the color scale, coloring each cell.
	// Zero value: cells are colored by Observable Plot's default scheme.
	fill *sql.SqlField `dashica-gen:"client,role=measure"`
	// title is the chart title shown above the plot.
	title string `dashica-gen:"client"`
	// id is the stable widget id (its URL "<page>/api/<id>"); assigned by the page when empty.
	id string
	// height is the chart height in pixels. Zero value: Observable Plot's default.
	height *int `dashica-gen:"client"`
	// width is the chart width in pixels. Zero value: fills the container width.
	width *int `dashica-gen:"client"`
	// marginLeft is the left margin in pixels. Zero value: Observable Plot's default.
	marginLeft *int `dashica-gen:"client"`
	// colorScheme names an Observable Plot color scheme for the fill scale
	// (e.g. "blues", "inferno"). Zero value: the dashboard's default
	// light/dark scheme. Ignored when color is set.
	// Docs: https://observablehq.com/plot/features/scales#color-scales
	colorScheme string `dashica-gen:"client"`
	// color configures the color scale used for fill; takes precedence over colorScheme.
	color *color.ColorScale `dashica-gen:"client"`
	// xBucketSize is the width of each time bucket on the x axis, in milliseconds.
	xBucketSize int64 `dashica-gen:"client"`
	// yBucketSize is sent to the API but not used by the ordinal heatmap's
	// rendering, since rows are one per distinct y value rather than bucketed.
	yBucketSize int64 `dashica-gen:"client"`
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
	chartProps := h.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("timeHeatmapOrdinal: failed to marshal chart props: %w", err)
	}

	heightVal := 0
	if h.height != nil {
		heightVal = *h.height
	}
	return chartComponent(ctx, h, "timeHeatmapOrdinal", string(chartPropsJSON), heightVal), nil
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

func (h *TimeHeatmapOrdinal) Handler(deps rendering.Dependencies) http.Handler {
	return queryHandler(deps, h.buildQuery())
}

func (h *TimeHeatmapOrdinal) explicitId() string { return h.id }

var _ WidgetDefinition = (*TimeHeatmapOrdinal)(nil)
