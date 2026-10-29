package widget

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

func TestSpeedscopeLink_RendersCSPFriendlyMarkup(t *testing.T) {
	w := NewSpeedscopeLink(sql.New(sql.From("profiling_traces"))).
		Title("Open Speedscope").
		Id("widget-1")

	out := renderComponent(t, w)
	mustContain(t, out, `x-data="speedscopeLink"`)
	mustContain(t, out, `data-widget-base-url="/d/api/widget-1"`)
	mustContain(t, out, `:href="href()"`)
	mustContain(t, out, `target="_blank"`)
	mustContain(t, out, `Open Speedscope`)
}

func TestSpeedscopeLink_DefaultTitle(t *testing.T) {
	w := NewSpeedscopeLink(sql.New(sql.From("t"))).Id("w")
	out := renderComponent(t, w)
	mustContain(t, out, `Open Speedscope`)
}

func TestSpeedscopeLink_ServesTheViewerBelowItsURL(t *testing.T) {
	w := NewSpeedscopeLink(sql.New(sql.From("t"))).Id("widget-7")
	mux := http.NewServeMux()
	nodes, err := Widgets{w}.Mount(&rendering.DashboardContext{CurrentHandlerUrl: "/d"}, handler_collector.NewValidatingCollector(mux, zerolog.Nop()).Nested("/d/api"))
	if err != nil {
		t.Fatalf("Mount: %v", err)
	}
	if nodes[0].Type != "speedscopeLink" || nodes[0].DataURL != "/d/api/widget-7" {
		t.Errorf("unexpected node %+v", nodes[0])
	}
	// .gitkeep is the one file of the viewer's dist that is checked in.
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/d/api/widget-7/viewer/.gitkeep", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("viewer: %d %s", rec.Code, rec.Body)
	}
}

func TestSpeedscopeLink_Immutability(t *testing.T) {
	original := NewSpeedscopeLink(sql.New(sql.From("t")))
	_ = original.Title("hi")
	if original.title != "" {
		t.Errorf("original mutated by Title()")
	}
}

func TestSpeedscopeLink_ContextNotShared(t *testing.T) {
	w := NewSpeedscopeLink(sql.New(sql.From("t"))).Id("w1")
	a := renderComponent(t, w)
	b := renderComponent(t, w)
	if !strings.Contains(a, "speedscopeLink") || a != b {
		t.Errorf("rendering not stable")
	}
}
