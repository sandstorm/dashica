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

// BarVertical draws bars from bottom to top: x is the grouping/category axis,
// y is the value axis.
type BarVertical struct {
	// sql is the underlying query builder; adjust it with AdjustQuery.
	sql sql.SqlQueryable
	// x is the category (grouping) field, plotted on the horizontal axis.
	x sql.SqlField `dashica-gen:"role=dimension"`
	// y is the measure plotted as bar height.
	y sql.SqlField `dashica-gen:"role=measure"`
	// fill is the series bound to the color scale. Zero value: bars use a
	// single default color, or are colored by x when fx is set.
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
	// colorScheme is currently unused by this widget; reserved for a future
	// direct color-scheme override.
	colorScheme string
	// color configures the color scale used for fill. Zero value: an ordinal
	// scale with the observable10 scheme, shown with a legend.
	color *color.ColorScale
	// sortReverse sorts the x domain by y value when set; true for descending
	// order, false for ascending. Zero value (nil): input order, unsorted.
	sortReverse *bool
	// tipChannels adds extra labeled channels to the hover tooltip.
	tipChannels map[string]string
}

func NewBarVertical(sql sql.SqlQueryable) *BarVertical {
	return &BarVertical{
		sql:    sql,
		height: 200,
	}
}

func (b *BarVertical) X(xField sql.SqlField) *BarVertical {
	cloned := *b
	cloned.x = xField
	return &cloned
}

func (b *BarVertical) Y(yField sql.SqlField) *BarVertical {
	cloned := *b
	cloned.y = yField
	return &cloned
}

func (b *BarVertical) Fill(fillField sql.SqlField) *BarVertical {
	cloned := *b
	cloned.fill = &fillField
	return &cloned
}

func (b *BarVertical) Fx(fxField sql.SqlField) *BarVertical {
	cloned := *b
	cloned.fx = &fxField
	return &cloned
}

func (b *BarVertical) Fy(fyField sql.SqlField) *BarVertical {
	cloned := *b
	cloned.fy = &fyField
	return &cloned
}

func (b *BarVertical) Title(title string) *BarVertical {
	cloned := *b
	cloned.title = title
	return &cloned
}

func (b *BarVertical) Id(id string) *BarVertical {
	cloned := *b
	cloned.id = id
	return &cloned
}

func (b *BarVertical) Height(height int) *BarVertical {
	cloned := *b
	cloned.height = height
	return &cloned
}

func (b *BarVertical) Width(width int) *BarVertical {
	cloned := *b
	cloned.width = &width
	return &cloned
}

func (b *BarVertical) MarginLeft(margin int) *BarVertical {
	cloned := *b
	cloned.marginLeft = &margin
	return &cloned
}

func (b *BarVertical) MarginRight(margin int) *BarVertical {
	cloned := *b
	cloned.marginRight = &margin
	return &cloned
}

func (b *BarVertical) MarginBottom(margin int) *BarVertical {
	cloned := *b
	cloned.marginBottom = &margin
	return &cloned
}

func (b *BarVertical) MarginTop(margin int) *BarVertical {
	cloned := *b
	cloned.marginTop = &margin
	return &cloned
}

func (b *BarVertical) Color(opts ...color.ColorScaleOption) *BarVertical {
	cloned := *b
	if cloned.color == nil {
		cloned.color = color.New()
	}
	cloned.color = cloned.color.With(opts...)
	return &cloned
}

// SortByY sorts the X axis by Y values. Pass reverse=true for descending order.
func (b *BarVertical) SortByY(reverse bool) *BarVertical {
	cloned := *b
	cloned.sortReverse = &reverse
	return &cloned
}

// TipChannels adds extra channels to the tooltip with custom labels.
// channels maps display label → data field name, e.g. {"Instanz": "instance"}.
func (b *BarVertical) TipChannels(channels map[string]string) *BarVertical {
	cloned := *b
	cloned.tipChannels = channels
	return &cloned
}

func (b *BarVertical) AdjustQuery(opts ...sql.SqlBuilderOption) *BarVertical {
	cloned := *b
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func (b *BarVertical) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	chartProps := b.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("barVertical: failed to marshal chart props: %w", err)
	}

	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+b.id, "barVertical", string(chartPropsJSON), b.height), nil
}

func (b *BarVertical) buildChartProps() map[string]interface{} {
	props := make(map[string]interface{})

	// Required fields
	props["height"] = b.height
	props["x"] = b.x.Alias()
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
	if b.sortReverse != nil {
		props["sort"] = map[string]interface{}{"x": "y", "reverse": *b.sortReverse}
	}
	if len(b.tipChannels) > 0 {
		props["tip"] = map[string]interface{}{"channels": b.tipChannels}
	}

	return props
}

func (b *BarVertical) buildQuery() sql.SqlQueryable {
	// Build the SQL query
	query := b.sql.With(
		sql.PrependSelect(b.x),
		sql.GroupBy(b.x),
		sql.Select(b.y),
	)

	if b.fill != nil {
		query = query.With(
			sql.PrependSelect(*b.fill),
			sql.GroupBy(*b.fill),
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

func (b *BarVertical) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	query := b.buildQuery()
	return RegisterQueryHandlers(b.id, "barVertical", query, ctx, registerHandler)
}

var _ InteractiveWidget = (*BarVertical)(nil)
