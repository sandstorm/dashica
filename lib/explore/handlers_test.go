// DEPRECATED (workbench): Explore's Go API, kept for its rebuild on the workbench; its UI is gone. Port into the rebuild or delete, then remove this line. See docs/2026-10-28-workbench.md §5.

package explore

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

func TestCollectHandlers_RegistersAllRoutes(t *testing.T) {
	mux := http.NewServeMux()
	collector := handler_collector.NewValidatingCollector(mux, zerolog.Nop())

	e := New() // dashboard.Dashboard

	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/explore", MainMenu: &[]rendering.MenuGroup{}, Deps: rendering.Dependencies{Config: &config.Config{}}}
	if _, err := e.CollectHandlers(ctx, collector.Nested("/explore")); err != nil {
		t.Fatalf("CollectHandlers: %v", err)
	}

	want := []string{
		"/explore",
		"/explore/api/formmodel",
		"/explore/api/gocode",
	}
	for _, path := range want {
		if !collector.IsRegistered(path) {
			t.Errorf("route %s not registered", path)
		}
	}
	// The browser's widget and SQL run only behind explore.enabled, in the workbench's handlers; the old Explore
	// API runs no query.
	for _, path := range []string{"/explore/api/preview/query", "/explore/api/preview/debug", "/explore/api/schema", "/explore/api/values"} {
		if collector.IsRegistered(path) {
			t.Errorf("route %s still registered", path)
		}
	}
}

func TestEditorPage_ShowsTheRebuildNotice(t *testing.T) {
	mux := http.NewServeMux()
	collector := handler_collector.NewValidatingCollector(mux, zerolog.Nop())
	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/explore", MainMenu: &[]rendering.MenuGroup{}, Deps: rendering.Dependencies{Config: &config.Config{}}}
	if _, err := New().CollectHandlers(ctx, collector.Nested("/explore")); err != nil {
		t.Fatalf("CollectHandlers: %v", err)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/explore", nil))
	if ct := rec.Header().Get("Content-Type"); rec.Code != http.StatusOK || !strings.HasPrefix(ct, "text/html") {
		t.Errorf("/explore: status %d, Content-Type %q; want the shell, 200 text/html", rec.Code, ct)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/explore/page.json", nil))
	if !strings.Contains(rec.Body.String(), "Explore is being rebuilt") {
		t.Errorf("page.json missing the rebuild notice: %s", rec.Body.String())
	}
}
