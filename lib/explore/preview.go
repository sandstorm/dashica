// DEPRECATED (workbench): Explore's Go API, kept for its rebuild on the workbench; its UI is gone. Port into the rebuild or delete, then remove this line. See docs/2026-10-28-workbench.md §5.

package explore

import (
	"fmt"
	"io"
	"net/http"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

// handlePreviewQuery executes a JSON-described widget and streams its result in
// exactly the format a compiled widget's /query endpoint produces — so the
// existing `chart` frontend component consumes it unchanged.
//
// Body: one widget envelope ({"type": ..., "props": ...}). Query args
// (filters, params) are the same as a compiled widget's endpoint and are read
// by the underlying QueryHandler off the request URL.
func (e *exploreImpl) handlePreviewQuery(w http.ResponseWriter, r *http.Request) error {
	return e.dispatchPreview(w, r, "query")
}

// handlePreviewDebug is the same as handlePreviewQuery but delegates to the
// widget's /debug endpoint (SQL + EXPLAIN), powering the preview debug drawer.
func (e *exploreImpl) handlePreviewDebug(w http.ResponseWriter, r *http.Request) error {
	return e.dispatchPreview(w, r, "debug")
}

// dispatchPreview deserializes the widget from the request body and hands the
// request to the widget's own handler at "/<endpoint>". This reuses the *exact*
// compiled query path (the widget's Handler → QueryHandler) — no parallel
// execution logic to drift.
func (e *exploreImpl) dispatchPreview(w http.ResponseWriter, r *http.Request, endpoint string) (err error) {
	// The widget arrives from the browser and is often incomplete (e.g. a
	// freshly-added chart with no x/y yet); its buildQuery/buildChartProps then
	// dereference nil fields and panic. Turn that into a normal error so an
	// unfinished widget shows a preview error instead of crashing the server.
	defer recoverToError("preview "+endpoint, &err)

	if r.Method != http.MethodPost {
		return fmt.Errorf("preview %s: method %s not allowed, use POST", endpoint, r.Method)
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return fmt.Errorf("reading request body: %w", err)
	}

	wd, err := widget.UnmarshalWidget(body)
	if err != nil {
		return fmt.Errorf("deserializing widget: %w", err)
	}
	if wd == nil {
		return fmt.Errorf("preview: empty widget")
	}

	// The widget's Handler, as widget.Mount mounts it: a chart's "/query" and "/debug".
	data, ok := wd.(interface {
		Handler(deps rendering.Dependencies) http.Handler
	})
	if !ok {
		return fmt.Errorf("preview: widget type %T has no %s to preview", wd, endpoint)
	}
	below := r.Clone(r.Context())
	below.URL.Path = "/" + endpoint
	below.URL.RawPath = ""
	data.Handler(e.deps).ServeHTTP(w, below)
	return nil
}

// recoverToError converts a panic during preview handling into an error on
// *errp. Preview widgets come from the browser and are frequently incomplete
// (missing required fields), which makes the widgets' own build code nil-deref;
// a builder-time panic must degrade to a 500 for that one request, never take
// the whole server down. Deferred with a named return so the error propagates.
func recoverToError(context string, errp *error) {
	if r := recover(); r != nil {
		*errp = fmt.Errorf("%s: widget is incomplete or invalid (%v)", context, r)
	}
}

// handlePreviewRender renders a JSON-described widget's own component to HTML
// and returns it. This is how the browser obtains the widget's chartType and
// chartProps: it is the widget's real BuildComponents output (the exact Chart
// element a compiled dashboard emits, with data-chart-type / data-chart-props
// attributes), so there is no parallel chartProps logic to drift. The frontend
// reads those attributes off the parsed DOM node (native HTML unescaping) and
// fetches the data separately from preview/query.
//
// Body: one widget envelope. UntrustedContent is set (docs §6) because the
// widget arrived from the browser and BuildComponents may render markdown.
func (e *exploreImpl) handlePreviewRender(w http.ResponseWriter, r *http.Request) (err error) {
	// See dispatchPreview: an incomplete widget's buildChartProps derefs nil
	// fields and panics. Recover into an error so the preview shows it instead
	// of crashing the server. BuildComponents runs before any bytes are written,
	// so the error still becomes a clean 500.
	defer recoverToError("preview render", &err)

	if r.Method != http.MethodPost {
		return fmt.Errorf("preview render: method %s not allowed, use POST", r.Method)
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return fmt.Errorf("reading request body: %w", err)
	}
	wd, err := widget.UnmarshalWidget(body)
	if err != nil {
		return fmt.Errorf("deserializing widget: %w", err)
	}
	if wd == nil {
		return fmt.Errorf("preview render: empty widget")
	}

	childCtx := &rendering.DashboardContext{
		MainMenu:          e.mainMenu,
		CurrentHandlerUrl: e.baseURL + "/api/preview",
		Deps:              e.deps,
		UntrustedContent:  true,
		// Preview render: every leaf chart stamps its own envelope + this base
		// so it queries via POST <base>/query. Fixes nested charts (each child
		// knows its own identity instead of the client retrofitting only the
		// first element with the top-level container envelope).
		PreviewBaseUrl: e.baseURL + "/api/preview",
	}
	comp, err := wd.BuildComponents(childCtx)
	if err != nil {
		return fmt.Errorf("building widget component: %w", err)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	return comp.Render(r.Context(), w)
}
