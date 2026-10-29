package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// serve mounts `d` at "/p/shop" on a fresh mux, as Dashica.RegisterDashboard does.
func serve(t *testing.T, d Dashboard) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	ctx := &rendering.DashboardContext{MainMenu: &[]rendering.MenuGroup{}, CurrentHandlerUrl: "/p/shop"}
	if err := d.CollectHandlers(ctx, handler_collector.NewValidatingCollector(mux, zerolog.Nop()).Nested("/p/shop")); err != nil {
		t.Fatalf("CollectHandlers: %v", err)
	}
	return mux
}

func TestPageJson_DescribesThePageAsMounted(t *testing.T) {
	logs := sql.New(sql.From("http_logs"))
	d := New().
		WithTitle("Shop").
		WithLayout(layout.DefaultPage).
		DefaultTimeRange("168h").
		FilterButton("Errors", "status >= 500").
		Widget(widget.NewMarkdown().Content("# Shop")).
		Widget(widget.NewGrid().Template("a b").
			Area("a", widget.NewTimeBar(logs).X(sql.Timestamp15Min()).Y(sql.Count()).Title("Requests")).
			Area("b", widget.NewTable(logs).Title("Latest")))

	rec := httptest.NewRecorder()
	serve(t, d).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/p/shop/page.json", nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("status %d, content type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	var page PageJson
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatalf("page.json: %v\n%s", err, rec.Body)
	}
	if page.Kind != "dashboard" || page.Title != "Shop" || page.DefaultTime != "168h" || !page.FilterBar || len(page.FilterButtons) != 1 || page.FilterButtons[0].QueryPart != "status >= 500" {
		t.Errorf("page: %s", rec.Body)
	}
	if len(page.Widgets) != 2 || page.Widgets[0].Type != "markdown" || page.Widgets[0].DataURL != "" || page.Widgets[1].Type != "grid" {
		t.Fatalf("widgets: %s", rec.Body)
	}
	areas := page.Widgets[1].Children
	if areas["a"].Type != "timeBar" || areas["a"].DataURL != "/p/shop/api/1" || areas["b"].DataURL != "/p/shop/api/2" {
		t.Errorf("areas: %+v", areas)
	}
}

func TestPageJson_RefusesADefaultTimeRangeThatIsNotADuration(t *testing.T) {
	d := New().WithLayout(layout.DefaultPage).DefaultTimeRange("7d")
	err := d.CollectHandlers(&rendering.DashboardContext{MainMenu: &[]rendering.MenuGroup{}}, handler_collector.NewValidatingCollector(http.NewServeMux(), zerolog.Nop()).Nested("/p/shop"))
	if err == nil || !strings.Contains(err.Error(), `DefaultTimeRange("7d") is not a Go duration`) {
		t.Errorf("err = %v", err)
	}
}
