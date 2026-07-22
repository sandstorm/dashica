package explore

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
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

// dispatchPreview deserializes the widget from the request body, replays the
// widget's own CollectHandlers against an in-memory collector to build its query
// handler, then hands the request to that handler. This reuses the *exact*
// compiled query path (widget_common.RegisterQueryHandlers → QueryHandler) — no
// parallel execution logic to drift.
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

	interactive, ok := wd.(widget.InteractiveWidget)
	if !ok {
		return fmt.Errorf("preview: widget type %T has no query to preview", wd)
	}

	// A fresh child context sharing the same dependencies. The widget assigns
	// its own id via NextWidgetId() (starting at "1"); we do not call
	// BuildComponents here, so CurrentHandlerUrl is only informational.
	//
	// The widget definition arrived as JSON from the browser, so this context is
	// UNTRUSTED — the invariant every Explore-built DashboardContext must uphold
	// (docs §6). It has no effect on query/debug dispatch (data, not HTML), but
	// setting it here keeps the seam live: the Phase 3 preview and Phase 6 stored
	// render, which DO call BuildComponents (markdown → HTML), inherit the same
	// discipline instead of re-deciding it.
	childCtx := &rendering.DashboardContext{
		MainMenu:          e.mainMenu,
		CurrentHandlerUrl: e.baseURL + "/api/preview",
		Deps:              e.deps,
		UntrustedContent:  true,
	}

	capture := &capturingCollector{handlers: map[string]http.Handler{}}
	if err := interactive.CollectHandlers(childCtx, capture); err != nil {
		return fmt.Errorf("building widget query handler: %w", err)
	}

	handler := capture.findBySuffix("/" + endpoint)
	if handler == nil {
		return fmt.Errorf("preview: widget registered no %q endpoint", endpoint)
	}
	handler.ServeHTTP(w, r)
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

// capturingCollector is an in-memory HandlerCollector: it records the handlers a
// widget's CollectHandlers registers (keyed by full path) instead of mounting
// them on a live mux, so the preview endpoint can invoke them directly.
type capturingCollector struct {
	prefix   string
	handlers map[string]http.Handler
}

func (c *capturingCollector) Handle(path string, handler http.Handler) error {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	c.handlers[c.prefix+path] = handler
	return nil
}

func (c *capturingCollector) HandleRoot(handler http.Handler) error {
	c.handlers[c.prefix] = handler
	return nil
}

func (c *capturingCollector) IsRegistered(path string) bool {
	_, ok := c.handlers[path]
	return ok
}

func (c *capturingCollector) Nested(prefix string) handler_collector.HandlerCollector {
	// Share the same handlers map so nested registrations land in one place.
	return &capturingCollector{prefix: c.prefix + prefix, handlers: c.handlers}
}

// findBySuffix returns the single captured handler whose path ends with suffix
// (e.g. "/query"). A previewed widget is a single leaf chart, so exactly one
// such handler exists; if several match (a container widget), the first is
// returned deterministically enough for the single-widget preview contract.
func (c *capturingCollector) findBySuffix(suffix string) http.Handler {
	for path, h := range c.handlers {
		if strings.HasSuffix(path, suffix) {
			return h
		}
	}
	return nil
}

var _ handler_collector.HandlerCollector = (*capturingCollector)(nil)
