package widget

import (
	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
)

// chartComponent builds the shared Chart element for a leaf widget: its data URL is the one Mount recorded
// (ctx.DataURL).
func chartComponent(ctx *rendering.DashboardContext, self WidgetDefinition, chartType, chartPropsJSON string, height int) templ.Component {
	return widget_component.Chart(ctx.DataURL(self), chartType, chartPropsJSON, height, "", "")
}
