package widget

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/util/handler_collector"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type BarVertical struct {
	sql          sql.SqlQueryable
	x            sql.SqlField
	y            sql.SqlField
	fill         *sql.SqlField
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
	colorScheme  string
	color        *color.ColorScale
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

	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+b.id, "barVertical", string(chartPropsJSON)), nil
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

	qh := httpserver.QueryHandler{
		ClickhouseClientManager: ctx.Deps.ClickhouseClientManager,
		Logger:                  ctx.Deps.Logger,
		FileSystem:              ctx.Deps.FileSystem,
	}
	err := registerHandler.Handle(b.id+"/query", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := qh.HandleQuery(query, w, r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	}))
	if err != nil {
		return fmt.Errorf("barVertical: %w", err)
	}
	return nil
}

var _ InteractiveWidget = (*BarVertical)(nil)
