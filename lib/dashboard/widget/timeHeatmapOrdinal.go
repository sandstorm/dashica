package widget

import (
	"net/http"

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
	// colorScheme is the Observable Plot color scheme of the fill scale
	// (color.SchemeBlues, color.SchemeInferno). Zero value: the dashboard's default
	// light/dark scheme. Ignored when color is set.
	// Docs: https://observablehq.com/plot/features/scales#color-scales
	colorScheme color.Scheme `dashica-gen:"client"`
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

// ColorScheme sets the color scheme of the fill scale (color.SchemeBlues).
func (h *TimeHeatmapOrdinal) ColorScheme(scheme color.Scheme) *TimeHeatmapOrdinal {
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
