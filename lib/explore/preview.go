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
func (e *exploreImpl) dispatchPreview(w http.ResponseWriter, r *http.Request, endpoint string) error {
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
	// BuildComponents, so CurrentHandlerUrl is only informational here.
	childCtx := &rendering.DashboardContext{
		MainMenu:          e.mainMenu,
		CurrentHandlerUrl: e.baseURL + "/api/preview",
		Deps:              e.deps,
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
