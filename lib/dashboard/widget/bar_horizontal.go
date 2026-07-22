package widget

import (
	"encoding/json"
	"fmt"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// BarHorizontal: bars go from left to right. x is the value axis, y is the category axis.
type BarHorizontal struct {
	// sql is the underlying query builder; adjust it with AdjustQuery.
	sql sql.SqlQueryable
	// x is the measure plotted as bar length.
	x sql.SqlField `dashica-gen:"role=measure"`
	// y is the category (grouping) field, plotted on the vertical axis.
	y sql.SqlField `dashica-gen:"role=dimension"`
	// fill is the series bound to the color scale. Zero value: bars use a
	// single default color, or are colored by y when fy is set.
	fill *sql.SqlField `dashica-gen:"role=dimension"`
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
}

func NewBarHorizontal(sqlq sql.SqlQueryable) *BarHorizontal {
	return &BarHorizontal{
		sql:    sqlq,
		height: 200,
	}
}

func (b *BarHorizontal) X(xField sql.SqlField) *BarHorizontal {
	cloned := *b
	cloned.x = xField
	return &cloned
}

func (b *BarHorizontal) Y(yField sql.SqlField) *BarHorizontal {
	cloned := *b
	cloned.y = yField
	return &cloned
}

func (b *BarHorizontal) Fill(fillField sql.SqlField) *BarHorizontal {
	cloned := *b
	cloned.fill = &fillField
	return &cloned
}

func (b *BarHorizontal) Title(title string) *BarHorizontal {
	cloned := *b
	cloned.title = title
	return &cloned
}

func (b *BarHorizontal) Id(id string) *BarHorizontal {
	cloned := *b
	cloned.id = id
	return &cloned
}

func (b *BarHorizontal) Height(height int) *BarHorizontal {
	cloned := *b
	cloned.height = height
	return &cloned
}

func (b *BarHorizontal) Width(width int) *BarHorizontal {
	cloned := *b
	cloned.width = &width
	return &cloned
}

func (b *BarHorizontal) MarginLeft(margin int) *BarHorizontal {
	cloned := *b
	cloned.marginLeft = &margin
	return &cloned
}

func (b *BarHorizontal) MarginRight(margin int) *BarHorizontal {
	cloned := *b
	cloned.marginRight = &margin
	return &cloned
}

func (b *BarHorizontal) MarginBottom(margin int) *BarHorizontal {
	cloned := *b
	cloned.marginBottom = &margin
	return &cloned
}

func (b *BarHorizontal) MarginTop(margin int) *BarHorizontal {
	cloned := *b
	cloned.marginTop = &margin
	return &cloned
}

func (b *BarHorizontal) Color(opts ...color.ColorScaleOption) *BarHorizontal {
	cloned := *b
	if cloned.color == nil {
		cloned.color = color.New()
	}
	cloned.color = cloned.color.With(opts...)
	return &cloned
}

func (b *BarHorizontal) AdjustQuery(opts ...sql.SqlBuilderOption) *BarHorizontal {
	cloned := *b
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func (b *BarHorizontal) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	props := b.buildChartProps()
	propsJSON, err := json.Marshal(props)
	if err != nil {
		return nil, fmt.Errorf("barHorizontal: failed to marshal chart props: %w", err)
	}

	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+b.id, "barHorizontal", string(propsJSON), b.height), nil
}

func (b *BarHorizontal) buildChartProps() map[string]interface{} {
	props := make(map[string]interface{})

	props["height"] = b.height
	props["x"] = b.x.Alias()
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
	if b.fill != nil {
		props["fill"] = (*b.fill).Alias()
	}
	if b.color != nil {
		props["color"] = b.color
	}

	return props
}

func (b *BarHorizontal) buildQuery() sql.SqlQueryable {
	query := b.sql.With(
		sql.PrependSelect(b.y),
		sql.GroupBy(b.y),
		sql.Select(b.x),
	)
	if b.fill != nil {
		query = query.With(
			sql.PrependSelect(*b.fill),
			sql.GroupBy(*b.fill),
		)
	}
	return query
}

func (b *BarHorizontal) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}
	query := b.buildQuery()
	return RegisterQueryHandlers(b.id, "barHorizontal", query, ctx, registerHandler)
}

var _ InteractiveWidget = (*BarHorizontal)(nil)
