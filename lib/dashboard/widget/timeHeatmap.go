package widget

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type TimeHeatmap struct {
	// sql is the underlying query builder; adjust it with AdjustQuery.
	sql sql.SqlQueryable
	// x is the timestamped time-axis field, bucketed by xBucketSize.
	x sql.TimestampedField `dashica-gen:"client"`
	// y is the numeric field bucketed by yBucketSize into the rectangle rows.
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
	// yBucketSize is the height of each row in y-axis units; required, must be positive.
	yBucketSize int64 `dashica-gen:"client"`
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
	return chartComponent(ctx, h, "timeHeatmap", string(chartPropsJSON), heightVal), nil
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

func (h *TimeHeatmap) Handler(deps rendering.Dependencies) http.Handler {
	return queryHandler(deps, h.buildQuery())
}

func (h *TimeHeatmap) explicitId() string { return h.id }

var _ WidgetDefinition = (*TimeHeatmap)(nil)
