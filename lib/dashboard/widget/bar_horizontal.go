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
	sql          sql.SqlQueryable
	x            sql.SqlField
	y            sql.SqlField
	fill         *sql.SqlField
	title        string
	id           string
	height       int
	width        *int
	marginLeft   *int
	marginRight  *int
	marginBottom *int
	marginTop    *int
	color        *color.ColorScale
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
