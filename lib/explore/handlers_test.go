package explore

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

func TestCollectHandlers_RegistersAllRoutes(t *testing.T) {
	mux := http.NewServeMux()
	collector := handler_collector.NewValidatingCollector(mux, zerolog.Nop())

	e := New() // dashboard.Dashboard

	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/explore", MainMenu: &[]rendering.MenuGroup{}}
	if err := e.CollectHandlers(ctx, collector.Nested("/explore")); err != nil {
		t.Fatalf("CollectHandlers: %v", err)
	}

	want := []string{
		"/explore",
		"/explore/api/preview/query",
		"/explore/api/preview/debug",
		"/explore/api/formmodel",
		"/explore/api/schema",
		"/explore/api/values",
	}
	for _, path := range want {
		if !collector.IsRegistered(path) {
			t.Errorf("route %s not registered", path)
		}
	}
}

func TestEditorPage_ServesHTML(t *testing.T) {
	e := newTestExplore()
	rec := httptest.NewRecorder()
	e.handleEditorPage(rec, httptest.NewRequest(http.MethodGet, "/explore", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
	if !strings.Contains(rec.Body.String(), "Dashica Explore") {
		t.Errorf("body missing title: %q", rec.Body.String())
	}
}
