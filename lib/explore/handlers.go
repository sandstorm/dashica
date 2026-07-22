package explore

import (
	"fmt"
	"io"
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
	if err := api.Handle("gocode", apiHandler(e.handleGocode).asHTTP()); err != nil {
		return err
	}
	return nil
}

// handleGocode turns the posted dashboard state (the editor JSON, identical to
// the dashboard wire format) into fluent-builder Go source and returns it as
// text/plain. This is docs requirement #1 (the Go-code drawer tab): a dashboard
// prototyped in the browser copy/pastes verbatim into the repo. The generator
// (gocode.go) reads the same wire format the round-trip serializers produce, so
// its output round-trips.
func (e *exploreImpl) handleGocode(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		return fmt.Errorf("gocode: method %s not allowed, use POST", r.Method)
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return fmt.Errorf("gocode: reading request body: %w", err)
	}
	src, err := GenerateDashboardCode(body)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, err = io.WriteString(w, src)
	return err
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

// editorPage renders the editor UI on the full-viewport ExplorePage layout: no
// dashboard sidebar and no global search bar — the editor owns the screen. The
// time range lives inside the preview pane (EditorShell's own compact strip),
// so the layout's searchBar option is unused here. All dynamic behaviour lives
// in the frontend `exploreEditor` Alpine component (frontend/explore/editor.ts):
// the shell is just the mount points it fills. Rendered via the shared layout
// so it links the same JS/CSS bundle as any dashboard.
func (e *exploreImpl) editorPage(ctx *rendering.DashboardContext) templ.Component {
	return layout.ExplorePage.Fn(*ctx, rendering.SearchBarOption{}, EditorShell(e.baseURL))
}
