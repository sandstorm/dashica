package dashica

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func TestWorkbenchJson_ListsTheGroupsAsRegisteredWhenAsked(t *testing.T) {
	d := &DashicaImpl{deps: rendering.Dependencies{ClickhouseClientManager: clickhouse.NewManager(&config.Config{}, zerolog.Nop())}}
	get := func() string {
		rec := httptest.NewRecorder()
		d.serveWorkbenchJson(rec, httptest.NewRequest(http.MethodGet, "/workbench.json", nil))
		if rec.Header().Get("Content-Type") != "application/json" {
			t.Errorf("content type %q", rec.Header().Get("Content-Type"))
		}
		return rec.Body.String()
	}

	if got := get(); got != `{"menu":[],"explore":false,"sqlEnabled":false,"connections":[]}`+"\n" {
		t.Errorf("before any group: %s", got)
	}
	d.RegisterDashboardGroup("Shop")
	if got := get(); got != `{"menu":[{"title":"Shop","entries":[]}],"explore":false,"sqlEnabled":false,"connections":[]}`+"\n" {
		t.Errorf("after registering: %s", got)
	}
}

func TestWorkbenchJson_SaysWhetherExploreAndSqlFiltersAreEnabledAndTheConnections(t *testing.T) {
	cfg := &config.Config{ClickHouse: map[string]config.ClickHouseConfig{"default": {}, "alert_storage": {}}}
	rec := httptest.NewRecorder()
	deps := rendering.Dependencies{ExploreEnabled: true, SqlEnabled: true, ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop())}
	(&DashicaImpl{deps: deps}).serveWorkbenchJson(rec, httptest.NewRequest(http.MethodGet, "/workbench.json", nil))

	if got := rec.Body.String(); got != `{"menu":[],"explore":true,"sqlEnabled":true,"connections":["alert_storage","default"]}`+"\n" {
		t.Errorf("got %s", got)
	}
}

func TestSchemaJson_IsServedAndAnswersNotFoundWhileExploreIsOff(t *testing.T) {
	logger := zerolog.New(zerolog.NewTestWriter(t))
	mux := http.NewServeMux()
	newDashicaImpl(&config.Config{}, logger, mux, rendering.Dependencies{ClickhouseClientManager: clickhouse.NewManager(&config.Config{}, logger), Logger: logger})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/schema.json?connection=default", nil))
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "explore.enabled") {
		t.Errorf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestWorkbenchJson_ListsEveryPagesOutline(t *testing.T) {
	logger := zerolog.New(zerolog.NewTestWriter(t))
	mux := http.NewServeMux()
	d := newDashicaImpl(&config.Config{}, logger, mux, rendering.Dependencies{
		ClickhouseClientManager: clickhouse.NewManager(&config.Config{}, logger),
		Logger:                  logger,
	})
	logs := sql.New(sql.From("http_logs"))
	details := widget.NewCollapsibleGroup().Title("Details")
	for i := range 10 {
		details = details.Widget(widget.NewTable(logs).Title(fmt.Sprintf("Table %d", i)))
	}
	d.RegisterDashboardGroup("Shop").
		RegisterDashboard("/p/shop", dashboard.New().
			Widget(widget.NewMarkdown().Content("# Shop")).
			Widget(widget.NewGrid().Template("requests errors").
				Area("requests", widget.NewTimeBar(logs).Title("Requests")).
				Area("errors", widget.NewTimeBar(logs).Title("Errors"))).
			Widget(widget.NewStats(logs)).
			Widget(details.Widget(widget.NewCollapsibleGroup().Title("Slow").
				Widget(widget.NewTimeBar(logs).Id("slow_requests").Title("Slow requests"))))).
		RegisterDashboard("/p/billing", dashboard.New().Widget(widget.NewTable(logs).Title("Invoices")))

	var got WorkbenchJson
	if err := json.Unmarshal([]byte(get(t, mux, "/workbench.json")), &got); err != nil {
		t.Fatal(err)
	}
	// the grid mounts its areas by name
	shop := []rendering.OutlineEntry{
		{Id: "1", Title: "Errors"},
		{Id: "2", Title: "Requests"},
	}
	for i := range 10 {
		shop = append(shop, rendering.OutlineEntry{Id: strconv.Itoa(i + 4), Title: fmt.Sprintf("Table %d", i), Group: "Details"})
	}
	shop = append(shop, rendering.OutlineEntry{Id: "slow_requests", Title: "Slow requests", Group: "Slow"})
	want := []rendering.MenuGroupEntry{
		{Title: "/p/shop", Url: "/p/shop", Outline: shop},
		{Title: "/p/billing", Url: "/p/billing", Outline: []rendering.OutlineEntry{{Id: "1", Title: "Invoices"}}},
	}
	if !reflect.DeepEqual(got.Menu[0].Entries, want) {
		t.Errorf("entries\n got %+v\nwant %+v", got.Menu[0].Entries, want)
	}
}

func TestStartPage_ServesTheShellAtTheRootOnly(t *testing.T) {
	logger := zerolog.New(zerolog.NewTestWriter(t))
	mux := http.NewServeMux()
	newDashicaImpl(&config.Config{}, logger, mux, rendering.Dependencies{Logger: logger})
	answer := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}

	if rec := answer("/"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "window.Dashica.boot()") {
		t.Errorf("GET /: %d %s", rec.Code, rec.Body)
	}
	if got := answer("/page.json").Body.String(); got != `{"kind":"home","title":"Home","filterBar":false,"filterButtons":[],"widgets":[]}` {
		t.Errorf("GET /page.json: %s", got)
	}
	if rec := answer("/p/unknown"); rec.Code != http.StatusNotFound {
		t.Errorf("GET /p/unknown: %d", rec.Code)
	}
}
