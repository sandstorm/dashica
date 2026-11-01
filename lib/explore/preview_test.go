// DEPRECATED (workbench): Explore's Go API, kept for its rebuild on the workbench; its UI is gone. Port into the rebuild or delete, then remove this line. See docs/2026-10-28-workbench.md §5.

package explore

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

// echoWidget is a fake widget with a query registered only for these tests. Its
// query handler echoes the request's `time` query arg, letting us assert
// that dispatchPreview reaches the widget's own /query handler with the
// original request intact — without a ClickHouse connection.
type echoWidget struct{}

func (e *echoWidget) Handler(rendering.Dependencies, string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/query", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "QUERY time="+r.URL.Query().Get("time")+" f="+strings.Join(r.URL.Query()["f"], ","))
	})
	mux.HandleFunc("/debug", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "DEBUG time="+r.URL.Query().Get("time"))
	})
	return mux
}

// nonInteractiveWidget is a fake widget with no query handler.
type nonInteractiveWidget struct{}

func init() {
	widget.Register("exploreTestEcho", widget.CategoryChart, func() widget.WidgetDefinition { return &echoWidget{} })
	widget.Register("exploreTestNonInteractive", widget.CategoryChart, func() widget.WidgetDefinition { return &nonInteractiveWidget{} })
}

func newTestExplore() *exploreImpl {
	return &exploreImpl{title: "Explore", baseURL: "/explore"}
}

func TestDispatchPreview_ReachesWidgetQueryHandler(t *testing.T) {
	e := newTestExplore()
	body := `{"type":"exploreTestEcho"}`
	req := httptest.NewRequest(http.MethodPost, "/explore/api/preview/query?time=24h", strings.NewReader(body))
	rec := httptest.NewRecorder()

	if err := e.handlePreviewQuery(rec, req); err != nil {
		t.Fatalf("handlePreviewQuery: %v", err)
	}
	got := rec.Body.String()
	want := `QUERY time=24h f=`
	if got != want {
		t.Errorf("body = %q, want %q", got, want)
	}
}

func TestDispatchPreview_DropsTheStructuredFilters(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodPost, "/explore/api/preview/query?time=1h&f=status:eq:500&f=host:ne:a", strings.NewReader(`{"type":"exploreTestEcho"}`))
	rec := httptest.NewRecorder()

	if err := e.handlePreviewQuery(rec, req); err != nil {
		t.Fatalf("handlePreviewQuery: %v", err)
	}
	if got, want := rec.Body.String(), "QUERY time=1h f="; got != want {
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
	if got := rec.Body.String(); got != "DEBUG time=" {
		t.Errorf("body = %q, want %q", got, "DEBUG time=")
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
