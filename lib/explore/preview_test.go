package explore

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// echoWidget is a fake InteractiveWidget registered only for these tests. Its
// query handler echoes the request's `filters` query arg, letting us assert
// that dispatchPreview reaches the widget's own /query handler with the
// original request intact — without a ClickHouse connection.
type echoWidget struct{}

func (e *echoWidget) BuildComponents(*rendering.DashboardContext) (templ.Component, error) {
	return templ.NopComponent, nil
}

func (e *echoWidget) CollectHandlers(ctx *rendering.DashboardContext, collector handler_collector.HandlerCollector) error {
	id := ctx.NextWidgetId()
	if err := collector.Handle(id+"/query", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "QUERY filters="+r.URL.Query().Get("filters"))
	})); err != nil {
		return err
	}
	return collector.Handle(id+"/debug", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "DEBUG filters="+r.URL.Query().Get("filters"))
	}))
}

// nonInteractiveWidget is a fake widget with no query handler.
type nonInteractiveWidget struct{}

func (n *nonInteractiveWidget) BuildComponents(*rendering.DashboardContext) (templ.Component, error) {
	return templ.NopComponent, nil
}

// chartEchoWidget renders a real Chart component so the render endpoint has a
// data-chart-props attribute to hand back — the mechanism the frontend uses to
// obtain chartProps without a ClickHouse connection.
type chartEchoWidget struct{}

func (c *chartEchoWidget) BuildComponents(*rendering.DashboardContext) (templ.Component, error) {
	return widget_component.Chart("/base", "timeBar", `{"x":"time","y":"count"}`, 150), nil
}

func (c *chartEchoWidget) CollectHandlers(ctx *rendering.DashboardContext, collector handler_collector.HandlerCollector) error {
	id := ctx.NextWidgetId()
	return collector.Handle(id+"/query", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
}

func init() {
	widget.Register("exploreTestEcho", func() widget.WidgetDefinition { return &echoWidget{} })
	widget.Register("exploreTestNonInteractive", func() widget.WidgetDefinition { return &nonInteractiveWidget{} })
	widget.Register("exploreTestChart", func() widget.WidgetDefinition { return &chartEchoWidget{} })
}

func newTestExplore() *exploreImpl {
	return &exploreImpl{title: "Explore", baseURL: "/explore"}
}

func TestDispatchPreview_ReachesWidgetQueryHandler(t *testing.T) {
	e := newTestExplore()
	body := `{"type":"exploreTestEcho"}`
	req := httptest.NewRequest(http.MethodPost, "/explore/api/preview/query?filters=%7B%22timeRange%22%3A%2224h%22%7D", strings.NewReader(body))
	rec := httptest.NewRecorder()

	if err := e.handlePreviewQuery(rec, req); err != nil {
		t.Fatalf("handlePreviewQuery: %v", err)
	}
	got := rec.Body.String()
	want := `QUERY filters={"timeRange":"24h"}`
	if got != want {
		t.Errorf("body = %q, want %q", got, want)
	}
}

func TestDispatchPreview_ReachesWidgetDebugHandler(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodPost, "/explore/api/preview/debug", strings.NewReader(`{"type":"exploreTestEcho"}`))
	rec := httptest.NewRecorder()

	if err := e.handlePreviewDebug(rec, req); err != nil {
		t.Fatalf("handlePreviewDebug: %v", err)
	}
	if got := rec.Body.String(); got != "DEBUG filters=" {
		t.Errorf("body = %q, want %q", got, "DEBUG filters=")
	}
}

func TestDispatchPreview_RejectsUnknownWidgetType(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodPost, "/explore/api/preview/query", strings.NewReader(`{"type":"nopeNotRegistered"}`))
	if err := e.handlePreviewQuery(httptest.NewRecorder(), req); err == nil {
		t.Fatal("expected error for unknown widget type")
	}
}

func TestDispatchPreview_RejectsMalformedJSON(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodPost, "/explore/api/preview/query", strings.NewReader(`{not json`))
	if err := e.handlePreviewQuery(httptest.NewRecorder(), req); err == nil {
		t.Fatal("expected error for malformed JSON")
	}
}

func TestDispatchPreview_RejectsNonPost(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodGet, "/explore/api/preview/query", nil)
	if err := e.handlePreviewQuery(httptest.NewRecorder(), req); err == nil {
		t.Fatal("expected error for GET")
	}
}

func TestDispatchPreview_RejectsNonInteractiveWidget(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodPost, "/explore/api/preview/query", strings.NewReader(`{"type":"exploreTestNonInteractive"}`))
	err := e.handlePreviewQuery(httptest.NewRecorder(), req)
	if err == nil || !strings.Contains(err.Error(), "no query to preview") {
		t.Fatalf("expected non-interactive error, got %v", err)
	}
}

func TestDispatchPreview_RejectsEmptyWidget(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodPost, "/explore/api/preview/query", strings.NewReader(`null`))
	if err := e.handlePreviewQuery(httptest.NewRecorder(), req); err == nil {
		t.Fatal("expected error for null widget")
	}
}

func TestPreviewRender_ReturnsWidgetMarkupWithChartProps(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodPost, "/explore/api/preview/render", strings.NewReader(`{"type":"exploreTestChart"}`))
	rec := httptest.NewRecorder()

	if err := e.handlePreviewRender(rec, req); err != nil {
		t.Fatalf("handlePreviewRender: %v", err)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `data-chart-type="timeBar"`) {
		t.Errorf("missing data-chart-type: %q", body)
	}
	// The chartProps JSON must be present (HTML-escaped by templ); the browser
	// reads it off the DOM node's dataset.
	if !strings.Contains(body, "data-chart-props") || !strings.Contains(body, "count") {
		t.Errorf("missing data-chart-props: %q", body)
	}
}

func TestPreviewRender_IncompleteWidgetErrorsNotPanics(t *testing.T) {
	// A real chart widget with no x/y (as a freshly-added widget has): its
	// buildChartProps derefs nil fields and panics. The handler must recover
	// into an error, not crash the server.
	e := newTestExplore()
	body := `{"type":"barHorizontal","props":{"height":200,"sql":{"kind":"table","table":"","where":[]}}}`
	req := httptest.NewRequest(http.MethodPost, "/explore/api/preview/render", strings.NewReader(body))
	rec := httptest.NewRecorder()

	err := e.handlePreviewRender(rec, req) // must not panic
	if err == nil || !strings.Contains(err.Error(), "incomplete or invalid") {
		t.Fatalf("expected recovered incomplete-widget error, got %v", err)
	}
}

func TestPreviewRender_RejectsNonPost(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodGet, "/explore/api/preview/render", nil)
	if err := e.handlePreviewRender(httptest.NewRecorder(), req); err == nil {
		t.Fatal("expected error for GET")
	}
}

func TestCapturingCollector_RecordsNestedPaths(t *testing.T) {
	c := &capturingCollector{handlers: map[string]http.Handler{}}
	api := c.Nested("/api")
	if err := api.Handle("1/query", http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})); err != nil {
		t.Fatal(err)
	}
	if err := api.Handle("1/debug", http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})); err != nil {
		t.Fatal(err)
	}
	if !c.IsRegistered("/api/1/query") {
		t.Errorf("expected /api/1/query registered, have %v", c.handlers)
	}
	if c.findBySuffix("/query") == nil {
		t.Error("findBySuffix(/query) returned nil")
	}
	if c.findBySuffix("/nope") != nil {
		t.Error("findBySuffix(/nope) should be nil")
	}
}
