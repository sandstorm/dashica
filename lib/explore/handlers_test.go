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
		"/explore/api/preview/render",
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
	mux := http.NewServeMux()
	collector := handler_collector.NewValidatingCollector(mux, zerolog.Nop())
	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/explore", MainMenu: &[]rendering.MenuGroup{}}
	if err := New().CollectHandlers(ctx, collector.Nested("/explore")); err != nil {
		t.Fatalf("CollectHandlers: %v", err)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/explore", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
	// The editor shell mounts the exploreEditor Alpine component; its presence
	// proves the page rendered through the shared layout.
	if !strings.Contains(rec.Body.String(), `x-data="exploreEditor"`) {
		t.Errorf("body missing editor shell: %q", rec.Body.String())
	}
}
