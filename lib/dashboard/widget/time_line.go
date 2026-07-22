package widget

import (
	"encoding/json"
	"fmt"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util/handler_collector"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type TimeLine struct {
	// sql is the underlying query builder; adjust it with AdjustQuery.
	sql sql.SqlQueryable
	// x is the timestamped time-axis field, bucketed by xBucketSize.
	x sql.TimestampedField
	// y is the measure plotted as the line's vertical position.
	y sql.SqlField `dashica-gen:"role=measure"`
	// stroke is a constant CSS color for the line. Zero value: '#4682B4'.
	// Ignored when strokeField is set.
	stroke string
	// strokeField is the series bound to the color scale, drawn as one line
	// per distinct value. Zero value: a single line colored by stroke.
	strokeField *sql.SqlField `dashica-gen:"role=dimension"`
	// zField groups points into separate lines without affecting color; use it
	// together with strokeField to draw one line per z value (e.g. per session)
	// all colored by the stroke value (e.g. per user), so overlapping series
	// stay visually distinct but share a color.
	zField *sql.SqlField `dashica-gen:"role=dimension"`
	// fx facets the chart horizontally, bound to the fx scale.
	fx *sql.SqlField `dashica-gen:"role=dimension"`
	// fy facets the chart vertically, bound to the fy scale.
	fy *sql.SqlField `dashica-gen:"role=dimension"`
	// title is the chart title shown above the plot.
	title string
	// id is the stable widget id; assigned automatically when empty.
	id string
	// height is the chart height in pixels.
	height int
	// width is the chart width in pixels. Zero value: fills the container width.
	width *int
	// marginLeft is the left margin in pixels. Zero value: Observable Plot's default.
	marginLeft *int
	// marginRight is the right margin in pixels. Zero value: Observable Plot's default.
	marginRight *int
	// marginBottom is the bottom margin in pixels. Zero value: Observable Plot's default.
	marginBottom *int
	// marginTop is the top margin in pixels. Zero value: Observable Plot's default.
	marginTop *int
	// color configures the color scale used for stroke. Zero value: an ordinal
	// scale with the observable10 scheme, shown with a legend.
	color *color.ColorScale
	// tipChannels adds extra labeled channels to the hover tooltip.
	tipChannels map[string]string
	// fillStep makes the x (time) axis use ClickHouse `WITH FILL STEP <step>`, so
	// empty time buckets are synthesized instead of the line interpolating across
	// them. It is a raw interval expression, e.g. "toIntervalHour(1)". Any
	// strokeField is used as the fill partition key (filled independently per
	// series); filled numeric y values default to 0. Zero value: no gap filling.
	fillStep string
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
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	chartProps := b.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("timeLine: failed to marshal chart props: %w", err)
	}

	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+b.id, "timeLine", string(chartPropsJSON), b.height), nil
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

func (b *TimeLine) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	query := b.buildQuery()
	return RegisterQueryHandlers(b.id, "timeLine", query, ctx, registerHandler)
}

var _ InteractiveWidget = (*TimeLine)(nil)
