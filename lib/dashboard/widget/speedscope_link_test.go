package widget

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

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
