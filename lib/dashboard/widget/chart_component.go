package widget

import (
	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
)

// chartComponent builds the shared Chart element for a leaf widget. It absorbs
// the widgetBaseUrl concatenation every leaf's BuildComponents used to inline
// (ctx.CurrentHandlerUrl + "/api/" + id) AND — in an Explore preview render
// (ctx.PreviewBaseUrl set) — stamps the widget's OWN envelope onto the element
// via MarshalWidget(self). That way each chart is born knowing what
// preview/query must re-execute, so a container's nested charts each fetch
// their own data (a leaf has exactly one /query handler) instead of the client
// retrofitting only the first element with the top-level envelope.
//
// In a compiled dashboard PreviewBaseUrl is empty: no marshal, the preview
// attributes are absent, output is byte-identical to before. A widget type not
// in the registry (e.g. the alert widgets) can't serialize to an envelope;
// MarshalWidget errors and we simply omit the preview attributes — such widgets
// are never previewed via Explore anyway.
func chartComponent(ctx *rendering.DashboardContext, self WidgetDefinition, id, chartType, chartPropsJSON string, height int) templ.Component {
	widgetBaseUrl := ctx.CurrentHandlerUrl + "/api/" + id

	var previewBase, previewBody string
	if ctx.PreviewBaseUrl != "" {
		if env, err := MarshalWidget(self); err == nil {
			previewBase = ctx.PreviewBaseUrl
			previewBody = string(env)
		}
	}

	return widget_component.Chart(widgetBaseUrl, chartType, chartPropsJSON, height, previewBase, previewBody)
}
