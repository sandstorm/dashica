package explore

import (
	"net/http"

	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// registerHandlers wires the editor page and the API sub-routes. Route layout
// mirrors docs section 4.3. Everything lives under the registration URL; the
// API routes hang off a "/api" nested collector.
func (e *exploreImpl) registerHandlers(collector handler_collector.HandlerCollector) error {
	if err := collector.HandleRoot(http.HandlerFunc(e.handleEditorPage)); err != nil {
		return err
	}

	api := collector.Nested("/api")

	if err := api.Handle("preview/query", apiHandler(e.handlePreviewQuery).asHTTP()); err != nil {
		return err
	}
	if err := api.Handle("preview/debug", apiHandler(e.handlePreviewDebug).asHTTP()); err != nil {
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

// handleEditorPage serves the editor UI. The structured-form editor is built in
// Phase 3; for now this is a placeholder so the route exists and the runtime
// API can be exercised directly.
func (e *exploreImpl) handleEditorPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html><html><head><meta charset="utf-8"><title>Explore</title></head>` +
		`<body><h1>Dashica Explore</h1>` +
		`<p>The structured editor UI ships in Phase 4. The runtime API is live under ` +
		`<code>` + e.baseURL + `/api/</code>.</p></body></html>`))
}
