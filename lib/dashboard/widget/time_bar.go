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

type TimeBar struct {
	// sql is the underlying query builder; adjust it with AdjustQuery.
	sql sql.SqlQueryable
	// x is the timestamped time-axis field, bucketed by xBucketSize.
	x sql.TimestampedField
	// y is the measure plotted as bar height.
	y sql.SqlField `dashica-gen:"role=measure"`
	// fill is the series bound to the color scale and stacked per x bucket.
	// Zero value: bars use a single default color and are not stacked.
	fill *sql.SqlField `dashica-gen:"role=dimension"`
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
	// color configures the color scale used for fill. Zero value: an ordinal
	// scale with the observable10 scheme, shown with a legend.
	color *color.ColorScale
	// tipChannels adds extra labeled channels to the hover tooltip.
	tipChannels map[string]string
	// stack configures the Observable Plot stack transform (order, offset,
	// reverse) applied to the fill series.
	stack StackOptions
}

// StackOptions groups the Observable Plot stack transform options for the fill
// series (offset, order, reverse). Its zero value is Plot's default stacking.
// Docs: https://observablehq.com/plot/transforms/stack#stack-options
type StackOptions struct {
	// Order is the order in which the series are layered. Zero value = input
	// order (Plot default).
	Order StackOrder
	// Offset is the baseline method (e.g. OffsetExpand for a 0–1 share chart).
	// Zero value = a zero baseline (Plot default).
	Offset StackOffset
	// Reverse flips the chosen Order.
	Reverse bool
}

// StackOrder is the stacking order of the fill series. It wraps an unexported
// string so that only the package-defined Order* values compile — a bare
// literal like StackOrder{"banana"} is rejected (unkeyed field is unexported),
// giving enum-like safety without Go enums. Zero value = input order.
//
// Only orders valid for a vertical (stackY) bar chart are exposed; Plot's
// stackX-only "x" alias is intentionally omitted.
// Docs: https://observablehq.com/plot/transforms/stack#stack-options
type StackOrder struct{ v string }

var (
	// OrderValue stacks by ascending value (descending with StackOptions.Reverse).
	OrderValue = StackOrder{"value"}
	// OrderSum orders series by their total value — smallest total at the
	// bottom, which keeps a symlog y-axis readable.
	OrderSum = StackOrder{"sum"}
	// OrderAppearance orders series by the position of their maximum value.
	OrderAppearance = StackOrder{"appearance"}
	// OrderInsideOut puts the earliest-appearing series on the inside.
	OrderInsideOut = StackOrder{"inside-out"}
)

// StackOffset is the stack baseline method. Same enum-safety trick as
// StackOrder. Zero value = a zero baseline (Plot default).
// Docs: https://observablehq.com/plot/transforms/stack#stack-options
type StackOffset struct{ v string }

var (
	// OffsetExpand normalizes each stack to the 0–1 range (share of total).
	OffsetExpand = StackOffset{"expand"}
	// OffsetCenter centers each stack around a shared baseline (streamgraph).
	OffsetCenter = StackOffset{"center"}
	// OffsetWiggle minimizes apparent movement (streamgraph); implies
	// OrderInsideOut unless another order is set.
	OffsetWiggle = StackOffset{"wiggle"}
)

func (b *TimeBar) X(xField sql.TimestampedField) *TimeBar {
	cloned := *b
	cloned.x = xField
	return &cloned
}

func (b *TimeBar) Y(yField sql.SqlField) *TimeBar {
	cloned := *b
	cloned.y = yField
	return &cloned
}

func (b *TimeBar) Fill(fillField sql.SqlField) *TimeBar {
	cloned := *b
	cloned.fill = &fillField
	return &cloned
}

func (b *TimeBar) Fx(fxField sql.SqlField) *TimeBar {
	cloned := *b
	cloned.fx = &fxField
	return &cloned
}

func (b *TimeBar) Fy(fyField sql.SqlField) *TimeBar {
	cloned := *b
	cloned.fy = &fyField
	return &cloned
}

func (b *TimeBar) Title(title string) *TimeBar {
	cloned := *b
	cloned.title = title
	return &cloned
}

func (b *TimeBar) Id(id string) *TimeBar {
	cloned := *b
	cloned.id = id
	return &cloned
}

func (b *TimeBar) Height(height int) *TimeBar {
	cloned := *b
	cloned.height = height
	return &cloned
}

func (b *TimeBar) Width(width int) *TimeBar {
	cloned := *b
	cloned.width = &width
	return &cloned
}

func (b *TimeBar) MarginLeft(margin int) *TimeBar {
	cloned := *b
	cloned.marginLeft = &margin
	return &cloned
}

func (b *TimeBar) MarginRight(margin int) *TimeBar {
	cloned := *b
	cloned.marginRight = &margin
	return &cloned
}

func (b *TimeBar) MarginBottom(margin int) *TimeBar {
	cloned := *b
	cloned.marginBottom = &margin
	return &cloned
}

func (b *TimeBar) MarginTop(margin int) *TimeBar {
	cloned := *b
	cloned.marginTop = &margin
	return &cloned
}

func (b *TimeBar) Color(opts ...color.ColorScaleOption) *TimeBar {
	cloned := *b
	if cloned.color == nil {
		cloned.color = color.New()
	}
	cloned.color = cloned.color.With(opts...)
	return &cloned
}

// StackOptions sets the stacking options (order, offset, reverse) for the fill
// series. E.g. StackOptions(widget.StackOptions{Order: widget.OrderSum}) stacks the
// series with the smallest total at the bottom, keeping a symlog y-axis
// readable.
func (b *TimeBar) StackOptions(stack StackOptions) *TimeBar {
	cloned := *b
	cloned.stack = stack
	return &cloned
}

// TipChannels adds extra channels to the tooltip with custom labels.
func (b *TimeBar) TipChannels(channels map[string]string) *TimeBar {
	cloned := *b
	cloned.tipChannels = channels
	return &cloned
}

func (b *TimeBar) AdjustQuery(opts ...sql.SqlBuilderOption) *TimeBar {
	cloned := *b
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func NewTimeBar(sql sql.SqlQueryable) *TimeBar {
	return &TimeBar{
		sql:    sql,
		height: 200,
	}
}

func (b *TimeBar) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	chartProps := b.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("timeBar: failed to marshal chart props: %w", err)
	}

	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+b.id, "timeBar", string(chartPropsJSON), b.height), nil
}

func (b *TimeBar) buildChartProps() map[string]interface{} {
	props := make(map[string]interface{})

	// Required fields
	props["height"] = b.height
	props["x"] = b.x.Alias()
	props["xBucketSize"] = b.x.XBucketSizeMs()
	props["y"] = b.y.Alias()

	// Optional fields
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
	if b.fill != nil {
		props["fill"] = (*b.fill).Alias()
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
	if b.stack.Order.v != "" {
		props["order"] = b.stack.Order.v
	}
	if b.stack.Offset.v != "" {
		props["offset"] = b.stack.Offset.v
	}
	if b.stack.Reverse {
		props["reverse"] = b.stack.Reverse
	}

	return props
}

func (b *TimeBar) buildQuery() sql.SqlQueryable {
	// Build the SQL query
	query := b.sql.With(
		sql.PrependSelect(b.x),
		sql.GroupBy(b.x),
		sql.Select(b.y),
		sql.OrderBy(b.x),
	)

	if b.fill != nil {
		query = query.With(
			sql.PrependSelect(*b.fill),
			sql.GroupBy(*b.fill),
			sql.OrderBy(*b.fill),
		)
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

func (b *TimeBar) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	query := b.buildQuery()
	return RegisterQueryHandlers(b.id, "timeBar", query, ctx, registerHandler)
}

var _ InteractiveWidget = (*TimeBar)(nil)
