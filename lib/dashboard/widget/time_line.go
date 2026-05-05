package widget

import (
	"encoding/json"
	"fmt"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util/handler_collector"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type TimeLine struct {
	sql          sql.SqlQueryable
	x            sql.TimestampedField
	y            sql.SqlField
	stroke       string
	title        string
	id           string
	height       int
	width        *int
	marginLeft   *int
	marginRight  *int
	marginBottom *int
	marginTop    *int
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
	if b.stroke != "" {
		props["stroke"] = b.stroke
	}

	return props
}

func (b *TimeLine) buildQuery() sql.SqlQueryable {
	return b.sql.With(
		sql.PrependSelect(b.x),
		sql.GroupBy(b.x),
		sql.Select(b.y),
		sql.OrderBy(b.x),
	)
}

func (b *TimeLine) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	query := b.buildQuery()
	return RegisterQueryHandlers(b.id, "timeLine", query, ctx, registerHandler)
}

var _ InteractiveWidget = (*TimeLine)(nil)
