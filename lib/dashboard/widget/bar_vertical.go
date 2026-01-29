package widget

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util/handler_collector"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type BarVertical struct {
	sql          sql.SqlBuilder
	x            sql.SqlField
	y            sql.SqlField
	fill         *sql.SqlField
	fx           *sql.SqlField
	fy           *sql.SqlField
	title        string
	id           string
	height       *int
	width        *int
	marginLeft   *int
	marginRight  *int
	marginBottom *int
	marginTop    *int
	colorScheme  string
}

func NewBarVertical(sql sql.SqlBuilder) *BarVertical {
	return &BarVertical{
		sql: sql,
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
	cloned.height = &height
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

func (b *BarVertical) ColorScheme(scheme string) *BarVertical {
	cloned := *b
	cloned.colorScheme = scheme
	return &cloned
}

func (b *BarVertical) Where(s string) *BarVertical {
	cloned := *b
	cloned.sql = cloned.sql.Where(s)
	return &cloned
}

func (b *BarVertical) BuildComponents(renderingContext rendering.DashboardContext) (templ.Component, error) {
	if len(b.id) == 0 {
		return nil, fmt.Errorf("barVertical: id is required")
	}

	chartProps := b.buildChartProps()
	chartPropsJSON, err := json.Marshal(chartProps)
	if err != nil {
		return nil, fmt.Errorf("barVertical: failed to marshal chart props: %w", err)
	}

	return widget_component.Chart("barVertical", string(chartPropsJSON)), nil
}

func (b *BarVertical) buildChartProps() map[string]interface{} {
	props := make(map[string]interface{})

	// Required fields
	props["x"] = b.x.Alias
	props["y"] = b.y.Alias

	// Optional fields
	if b.title != "" {
		props["title"] = b.title
	}
	if b.height != nil {
		props["height"] = *b.height
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
		props["fill"] = (*b.fill).Alias
	}
	if b.fx != nil {
		props["fx"] = (*b.fx).Alias
	}
	if b.fy != nil {
		props["fy"] = (*b.fy).Alias
	}
	if b.colorScheme != "" {
		props["color"] = map[string]string{"scheme": b.colorScheme}
	}

	return props
}

func (b *BarVertical) CollectHandlers(ctx rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(b.id) == 0 {
		return fmt.Errorf("barVertical: id is required")
	}

	// Build the SQL query
	sqlBuilder := b.sql.
		PrependSelect(b.x).
		GroupBy(b.x).
		Select(b.y)

	if b.fill != nil {
		sqlBuilder = sqlBuilder.PrependSelect(*b.fill).GroupBy(*b.fill)
	}
	if b.fx != nil {
		sqlBuilder = sqlBuilder.PrependSelect(*b.fx).GroupBy(*b.fx)
	}
	if b.fy != nil {
		sqlBuilder = sqlBuilder.PrependSelect(*b.fy).GroupBy(*b.fy)
	}

	err := registerHandler.Handle(b.id, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// TODO: Execute SQL query and return data
		println("BAR VERTICAL HANDLER CALLED for", b.id)

		// This should execute the SQL query and return JSON data
		// For now, just a placeholder
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
	}))
	if err != nil {
		return fmt.Errorf("barVertical: %w", err)
	}
	return nil
}

var _ InteractiveWidget = (*BarVertical)(nil)
