package explore

import (
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// registerHandlers wires the editor page and the API sub-routes. Route layout
// mirrors docs section 4.3. Everything lives under the registration URL; the
// API routes hang off a "/api" nested collector.
func (e *exploreImpl) registerHandlers(ctx *rendering.DashboardContext, collector handler_collector.HandlerCollector) error {
	if err := collector.HandleRoot(templ.Handler(e.editorPage(ctx))); err != nil {
		return err
	}

	api := collector.Nested("/api")

	if err := api.Handle("preview/query", apiHandler(e.handlePreviewQuery).asHTTP()); err != nil {
		return err
	}
	if err := api.Handle("preview/debug", apiHandler(e.handlePreviewDebug).asHTTP()); err != nil {
		return err
	}
	if err := api.Handle("preview/render", apiHandler(e.handlePreviewRender).asHTTP()); err != nil {
		return err
	}
	if err := api.Handle("formmodel", apiHandler(e.handleFormModel).asHTTP()); err != nil {
		return err
	}
	if err := api.Handle("schema", apiHandler(e.handleSchema).asHTTP()); err != nil {
		return err
	}
	if err := api.Handle("values", apiHandler(e.handleValues).asHTTP()); err != nil {
		return err
	}
	return nil
}

// apiHandler is an http.Handler that may return an error; asHTTP converts a
// returned error into a 500 with the error text — matching the style of the
// widget query handlers (widget_common.go).
type apiHandler func(w http.ResponseWriter, r *http.Request) error

func (h apiHandler) asHTTP() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
}

// editorPage renders the editor UI: the standard Dashica page chrome (sidebar,
// search bar — the latter drives the preview time range) wrapping the editor
// shell. All dynamic behaviour lives in the frontend `exploreEditor` Alpine
// component (frontend/explore/editor.ts): the shell is just the mount points it
// fills. Rendered via the shared layout so it links the same JS/CSS bundle as
// any dashboard.
func (e *exploreImpl) editorPage(ctx *rendering.DashboardContext) templ.Component {
	searchBar := rendering.SearchBarOption{IsVisible: true}
	return layout.DefaultPage.Fn(*ctx, searchBar, EditorShell(e.baseURL))
}
