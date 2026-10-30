package widget

import (
	"net/http"

	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type TimeBar struct {
	// sql is the underlying query builder; adjust it with AdjustQuery.
	sql sql.SqlQueryable
	// x is the timestamped time-axis field, bucketed by xBucketSize.
	x sql.TimestampedField `dashica-gen:"client"`
	// y is the measure plotted as bar height.
	y sql.SqlField `dashica-gen:"client,role=measure"`
	// fill is the series bound to the color scale and stacked per x bucket.
	// Zero value: bars use a single default color and are not stacked.
	fill *sql.SqlField `dashica-gen:"client,role=dimension"`
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
	// logScale starts the chart on a log scale; the viewer turns it on and off in the chart's menu. Zero value: linear.
	logScale bool `dashica-gen:"client"`
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
	// color configures the color scale used for fill. Zero value: an ordinal
	// scale with the observable10 scheme, shown with a legend.
	color *color.ColorScale `dashica-gen:"client"`
	// tipChannels adds extra labeled channels to the hover tooltip.
	tipChannels map[string]string `dashica-gen:"client"`
	// stack configures the Observable Plot stack transform (order, offset,
	// reverse) applied to the fill series.
	stack StackOptions `dashica-gen:"client,method=StackOptions"`
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
//
//dashicagen:enum
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
//
//dashicagen:enum
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

func (b *TimeBar) LogScale() *TimeBar {
	cloned := *b
	cloned.logScale = true
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

func (b *TimeBar) Handler(deps rendering.Dependencies) http.Handler {
	return queryHandler(deps, b.buildQuery())
}

func (b *TimeBar) explicitId() string { return b.id }
