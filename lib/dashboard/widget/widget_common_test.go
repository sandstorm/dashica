package widget

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// pathEcho is a widget whose handler answers with the path it sees.
type pathEcho struct{}

func (pathEcho) marshalProps(*rendering.DashboardContext) ([]byte, error) { return []byte("{}"), nil }

func (pathEcho) Handler(rendering.Dependencies) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, r.URL.Path) })
}

func init() {
	Register("_pathEcho", CategoryChart, func() WidgetDefinition { return pathEcho{} })
}

func mountPage(t *testing.T, widgets ...WidgetDefinition) (*rendering.DashboardContext, *http.ServeMux, handler_collector.HandlerCollector, []Node) {
	t.Helper()
	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/p/shop", Deps: testDeps()}
	mux := http.NewServeMux()
	handlers := handler_collector.NewValidatingCollector(mux, zerolog.Nop()).Nested("/p/shop/api")
	nodes, err := Widgets(widgets).Mount(ctx, handlers)
	if err != nil {
		t.Fatalf("Mount: %v", err)
	}
	return ctx, mux, handlers, nodes
}

func TestMount_NumbersTheWidgetsWithHandlersInOrderAndMountsThemAtTheirIds(t *testing.T) {
	errors := NewTimeBar(sql.New(sql.From("http_logs"))).X(sql.Timestamp15Min()).Y(sql.Count()).Title("Errors")
	byStatus := NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count())
	revenue := NewStats(sql.New(sql.From("payments"))).Id("shop_revenue_stats")
	group := NewCollapsibleGroup().Title("Details").Widget(NewGrid().Template("a b").Area("a", byStatus).Area("b", revenue))
	ctx, _, handlers, nodes := mountPage(t, errors, group)

	for _, path := range []string{"/p/shop/api/1/", "/p/shop/api/2/", "/p/shop/api/shop_revenue_stats/"} {
		if !handlers.IsRegistered(path) {
			t.Errorf("expected %s to be registered", path)
		}
	}
	if nodes[0].DataURL != "/p/shop/api/1" || ctx.DataURL(errors) != "/p/shop/api/1" {
		t.Errorf("time bar: node %q, context %q", nodes[0].DataURL, ctx.DataURL(errors))
	}
	if nodes[1].Type != "collapsibleGroup" || nodes[1].DataURL != "" || nodes[1].Children["0"].Children["a"].DataURL != "/p/shop/api/2" {
		t.Errorf("containers have no URL, their children theirs: %+v", nodes[1])
	}
	var props map[string]any
	if err := json.Unmarshal(nodes[0].Props, &props); err != nil || props["title"] != "Errors" || props["sql"] != nil {
		t.Errorf("time bar props: title kept, query left out, got %s (%v)", nodes[0].Props, err)
	}
	area := nodes[1].Children["0"].Children["b"]
	if area.Type != "stats" || area.DataURL != "/p/shop/api/shop_revenue_stats" {
		t.Errorf("explicit id: %+v", area)
	}
}

func TestMount_TheHandlerSeesThePathBelowTheWidgetsURL(t *testing.T) {
	_, mux, _, nodes := mountPage(t, pathEcho{})
	if nodes[0].Type != "_pathEcho" || nodes[0].DataURL != "/p/shop/api/1" {
		t.Fatalf("unexpected node %+v", nodes[0])
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/p/shop/api/1/viewer/index.html", nil))
	if rec.Body.String() != "/viewer/index.html" {
		t.Errorf("handler saw %q", rec.Body)
	}
}

func TestMount_ServesTheQueryAChartRunsWithItsOwnAdjustments(t *testing.T) {
	table := NewTable(sql.New(sql.From("http_logs"), sql.Select(sql.Field("host")))).Limit(25)
	stats := NewStats(sql.New(sql.From("payments"), sql.Select(sql.Field("sum(amount)").WithAlias("value")))).
		TitleField(sql.Field("currency"))
	// /debug answers the built query; its EXPLAINs fail against the unreachable server and stay unchecked.
	unreachable := map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1", Database: "default"}}
	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/p/shop", Deps: rendering.Dependencies{
		ClickhouseClientManager: clickhouse.NewManager(&config.Config{ClickHouse: unreachable}, zerolog.Nop()),
	}}
	mux := http.NewServeMux()
	nodes, err := Widgets{table, stats}.Mount(ctx, handler_collector.NewValidatingCollector(mux, zerolog.Nop()).Nested("/p/shop/api"))
	if err != nil {
		t.Fatalf("Mount: %v", err)
	}

	for i, want := range []string{"LIMIT 25", "currency"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, nodes[i].DataURL+"/debug?time=1h", nil))
		var debug struct{ Query string }
		if err := json.Unmarshal(rec.Body.Bytes(), &debug); err != nil || !strings.Contains(debug.Query, want) {
			t.Errorf("%s: want %q in the query, got %d %s (%v)", nodes[i].Type, want, rec.Code, rec.Body, err)
		}
	}
}

func TestMount_RefusesAnUnregisteredWidget(t *testing.T) {
	type unregistered struct{ pathEcho }
	_, err := Widgets{unregistered{}}.Mount(&rendering.DashboardContext{}, handler_collector.NewValidatingCollector(http.NewServeMux(), zerolog.Nop()))
	if !errors.Is(err, ErrWidgetNotRegistered) {
		t.Errorf("got %v", err)
	}
}
