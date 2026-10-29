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

type TimeLine struct {
	// sql is the underlying query builder; adjust it with AdjustQuery.
	sql sql.SqlQueryable
	// x is the timestamped time-axis field, bucketed by xBucketSize.
	x sql.TimestampedField `dashica-gen:"client"`
	// y is the measure plotted as the line's vertical position.
	y sql.SqlField `dashica-gen:"client,role=measure"`
	// stroke is a constant CSS color for the line. Zero value: '#4682B4'.
	// Ignored when strokeField is set.
	stroke string `dashica-gen:"client"`
	// strokeField is the series bound to the color scale, drawn as one line
	// per distinct value. Zero value: a single line colored by stroke.
	strokeField *sql.SqlField `dashica-gen:"client,role=dimension"`
	// zField groups points into separate lines without affecting color; use it
	// together with strokeField to draw one line per z value (e.g. per session)
	// all colored by the stroke value (e.g. per user), so overlapping series
	// stay visually distinct but share a color.
	zField *sql.SqlField `dashica-gen:"client,role=dimension,method=Z"`
	// fx facets the chart horizontally, bound to the fx scale.
	fx *sql.SqlField `dashica-gen:"client,role=dimension"`
	// fy facets the chart vertically, bound to the fy scale.
	fy *sql.SqlField `dashica-gen:"client,role=dimension"`
	// title is the chart title shown above the plot.
	title string `dashica-gen:"client"`
	// id is the stable widget id (its URL "<page>/api/<id>"); assigned by the page when empty.
	id string
	// height is the chart height in pixels.
	height int `dashica-gen:"client"`
	// width is the chart width in pixels. Zero value: fills the container width.
	width *int `dashica-gen:"client"`
	// marginLeft is the left margin in pixels. Zero value: Observable Plot's default.
	marginLeft *int `dashica-gen:"client"`
	// marginRight is the right margin in pixels. Zero value: Observable Plot's default.
	marginRight *int `dashica-gen:"client"`
	// marginBottom is the bottom margin in pixels. Zero value: Observable Plot's default.
	marginBottom *int `dashica-gen:"client"`
	// marginTop is the top margin in pixels. Zero value: Observable Plot's default.
	marginTop *int `dashica-gen:"client"`
	// color configures the color scale used for stroke. Zero value: an ordinal
	// scale with the observable10 scheme, shown with a legend.
	color *color.ColorScale `dashica-gen:"client"`
	// tipChannels adds extra labeled channels to the hover tooltip.
	tipChannels map[string]string `dashica-gen:"client"`
	// fillStep makes the x (time) axis use ClickHouse `WITH FILL STEP <step>`, so
	// empty time buckets are synthesized instead of the line interpolating across
	// them. It is a raw interval expression, e.g. "toIntervalHour(1)". Any
	// strokeField is used as the fill partition key (filled independently per
	// series); filled numeric y values default to 0. Zero value: no gap filling.
	fillStep string `dashica-gen:"client,method=WithFillStep"`
}

func NewTimeLine(sql sql.SqlQueryable) *TimeLine {
	return &TimeLine{
		sql:    sql,
		height: 150,
	}
}

func (b *TimeLine) X(xField sql.TimestampedField) *TimeLine {
	cloned := *b
	cloned.x = xField
	return &cloned
}

func (b *TimeLine) Y(yField sql.SqlField) *TimeLine {
	cloned := *b
	cloned.y = yField
	return &cloned
}

func (b *TimeLine) Stroke(stroke string) *TimeLine {
	cloned := *b
	cloned.stroke = stroke
	return &cloned
}

func (b *TimeLine) StrokeField(strokeField sql.SqlField) *TimeLine {
	cloned := *b
	cloned.strokeField = &strokeField
	return &cloned
}

// Z groups points into separate lines by this field WITHOUT changing color.
// Use it together with StrokeField to draw one line per Z value (e.g. per
// session) all colored by the stroke value (e.g. per user), so overlapping
// series stay visually distinct but share a color.
func (b *TimeLine) Z(zField sql.SqlField) *TimeLine {
	cloned := *b
	cloned.zField = &zField
	return &cloned
}

func (b *TimeLine) Fx(fxField sql.SqlField) *TimeLine {
	cloned := *b
	cloned.fx = &fxField
	return &cloned
}

func (b *TimeLine) Fy(fyField sql.SqlField) *TimeLine {
	cloned := *b
	cloned.fy = &fyField
	return &cloned
}

func (b *TimeLine) Title(title string) *TimeLine {
	cloned := *b
	cloned.title = title
	return &cloned
}

func (b *TimeLine) Id(id string) *TimeLine {
	cloned := *b
	cloned.id = id
	return &cloned
}

func (b *TimeLine) Height(height int) *TimeLine {
	cloned := *b
	cloned.height = height
	return &cloned
}

func (b *TimeLine) Width(width int) *TimeLine {
	cloned := *b
	cloned.width = &width
	return &cloned
}

func (b *TimeLine) MarginLeft(margin int) *TimeLine {
	cloned := *b
	cloned.marginLeft = &margin
	return &cloned
}

func (b *TimeLine) MarginRight(margin int) *TimeLine {
	cloned := *b
	cloned.marginRight = &margin
	return &cloned
}

func (b *TimeLine) MarginBottom(margin int) *TimeLine {
	cloned := *b
	cloned.marginBottom = &margin
	return &cloned
}

func (b *TimeLine) MarginTop(margin int) *TimeLine {
	cloned := *b
	cloned.marginTop = &margin
	return &cloned
}

func (b *TimeLine) Color(opts ...color.ColorScaleOption) *TimeLine {
	cloned := *b
	if cloned.color == nil {
		cloned.color = color.New()
	}
	cloned.color = cloned.color.With(opts...)
	return &cloned
}

// TipChannels adds extra channels to the tooltip with custom labels.
func (b *TimeLine) TipChannels(channels map[string]string) *TimeLine {
	cloned := *b
	cloned.tipChannels = channels
	return &cloned
}

// WithFillStep makes the X (time) axis use ClickHouse `WITH FILL STEP <step>`,
// so empty time buckets are synthesized instead of the line interpolating
// across them. `step` is a raw interval expression, e.g. "toIntervalHour(1)".
// Any StrokeField is used as the fill partition key (filled independently per
// series). Filled numeric Y values default to 0.
func (b *TimeLine) WithFillStep(step string) *TimeLine {
	cloned := *b
	cloned.fillStep = step
	return &cloned
}

func (b *TimeLine) AdjustQuery(opts ...sql.SqlBuilderOption) *TimeLine {
	cloned := *b
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func (b *TimeLine) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	chartProps := b.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("timeLine: failed to marshal chart props: %w", err)
	}

	return chartComponent(ctx, b, "timeLine", string(chartPropsJSON), b.height), nil
}

func (b *TimeLine) buildChartProps() map[string]interface{} {
	props := make(map[string]interface{})

	props["height"] = b.height
	props["x"] = b.x.Alias()
	props["xBucketSize"] = b.x.XBucketSizeMs()
	props["y"] = b.y.Alias()

	if b.title != "" {
		props["title"] = b.title
	}
	if b.width != nil {
		props["width"] = *b.width
	}
	if b.marginLeft != nil {
		props["marginLeft"] = *b.marginLeft
	}
	if b.marginRight != nil {
		props["marginRight"] = *b.marginRight
	}
	if b.marginBottom != nil {
		props["marginBottom"] = *b.marginBottom
	}
	if b.marginTop != nil {
		props["marginTop"] = *b.marginTop
	}
	if b.strokeField != nil {
		props["stroke"] = (*b.strokeField).Alias()
	} else if b.stroke != "" {
		props["stroke"] = b.stroke
	}
	if b.zField != nil {
		props["z"] = (*b.zField).Alias()
	}
	if b.fx != nil {
		props["fx"] = (*b.fx).Alias()
	}
	if b.fy != nil {
		props["fy"] = (*b.fy).Alias()
	}
	if b.color != nil {
		props["color"] = b.color
	}
	if len(b.tipChannels) > 0 {
		props["tip"] = map[string]interface{}{"channels": b.tipChannels}
	}

	return props
}

func (b *TimeLine) buildQuery() sql.SqlQueryable {
	query := b.sql.With(
		sql.PrependSelect(b.x),
		sql.GroupBy(b.x),
		sql.Select(b.y),
	)

	// Without WITH FILL, keep the historical ORDER BY: time first, then stroke.
	// With WITH FILL, partition columns (stroke, z) must come BEFORE the time
	// column so ClickHouse fills each series independently and the time column
	// is last (WITH FILL attaches to the last ORDER BY column).
	if b.fillStep == "" {
		query = query.With(sql.OrderBy(b.x))
	}
	if b.strokeField != nil {
		query = query.With(
			sql.PrependSelect(*b.strokeField),
			sql.GroupBy(*b.strokeField),
			sql.OrderBy(*b.strokeField),
		)
	}
	if b.zField != nil {
		query = query.With(
			sql.PrependSelect(*b.zField),
			sql.GroupBy(*b.zField),
			sql.OrderBy(*b.zField),
		)
	}
	if b.fillStep != "" {
		query = query.With(sql.OrderBy(b.x), sql.WithFill(b.fillStep))
	}

	if b.fx != nil {
		query = query.With(
			sql.PrependSelect(*b.fx),
			sql.GroupBy(*b.fx),
		)
	}
	if b.fy != nil {
		query = query.With(
			sql.PrependSelect(*b.fy),
			sql.GroupBy(*b.fy),
		)
	}

	return query
}

func (b *TimeLine) Handler(deps rendering.Dependencies) http.Handler {
	return queryHandler(deps, b.buildQuery())
}

func (b *TimeLine) explicitId() string { return b.id }

var _ WidgetDefinition = (*TimeLine)(nil)
