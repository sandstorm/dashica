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
	sql          sql.SqlQueryable
	x            sql.TimestampedField
	y            sql.SqlField
	stroke       string
	strokeField  *sql.SqlField
	fx           *sql.SqlField
	fy           *sql.SqlField
	title        string
	id           string
	height       int
	width        *int
	marginLeft   *int
	marginRight  *int
	marginBottom *int
	marginTop    *int
	color        *color.ColorScale
	tipChannels  map[string]string
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
		sql.OrderBy(b.x),
	)

	if b.strokeField != nil {
		query = query.With(
			sql.PrependSelect(*b.strokeField),
			sql.GroupBy(*b.strokeField),
			sql.OrderBy(*b.strokeField),
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

func (b *TimeLine) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(b.id) == 0 {
		b.id = ctx.NextWidgetId()
	}

	query := b.buildQuery()
	return RegisterQueryHandlers(b.id, "timeLine", query, ctx, registerHandler)
}

var _ InteractiveWidget = (*TimeLine)(nil)
