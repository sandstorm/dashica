package dashboard

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func ctxWithExplore(exploreURL *string) *rendering.DashboardContext {
	return &rendering.DashboardContext{
		CurrentHandlerUrl: "/logs",
		ExploreBaseURL:    exploreURL,
		Deps:              rendering.Dependencies{Logger: zerolog.Nop()},
	}
}

func TestOpenInExplore_RedirectsWithState(t *testing.T) {
	d := New().WithTitle("Logs").WithLayout(layout.DefaultPage).Widget(widget.NewTable(nil))
	base := "/explore"
	h := d.openInExploreHandler(ctxWithExplore(&base))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/logs/open-in-explore", nil))

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	loc := rec.Header().Get("Location")
	prefix := base + "#s="
	if !strings.HasPrefix(loc, prefix) {
		t.Fatalf("Location = %q, want prefix %q", loc, prefix)
	}

	// The fragment is query-escaped base64 of the dashboard JSON; reverse it.
	unescaped, err := url.QueryUnescape(strings.TrimPrefix(loc, prefix))
	if err != nil {
		t.Fatalf("unescape: %v", err)
	}
	raw, err := base64.StdEncoding.DecodeString(unescaped)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	var p probe
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("state unmarshal: %v", err)
	}
	if p.Title != "Logs" || len(p.Widgets) != 1 || p.Widgets[0].Type != "table" {
		t.Errorf("decoded state = %+v, want title Logs + one table", p)
	}
}

func TestOpenInExplore_404WhenExploreUnregistered(t *testing.T) {
	d := New().WithLayout(layout.DefaultPage).Widget(widget.NewTable(nil))

	for _, tc := range []struct {
		name string
		url  *string
	}{
		{"nil pointer", nil},
		{"empty string", strPtr("")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := d.openInExploreHandler(ctxWithExplore(tc.url))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/logs/open-in-explore", nil))
			if rec.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404", rec.Code)
			}
		})
	}
}

func strPtr(s string) *string { return &s }
