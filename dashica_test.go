package dashica

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
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
	d := &DashicaImpl{}
	get := func() string {
		rec := httptest.NewRecorder()
		d.serveWorkbenchJson(rec, httptest.NewRequest(http.MethodGet, "/workbench.json", nil))
		if rec.Header().Get("Content-Type") != "application/json" {
			t.Errorf("content type %q", rec.Header().Get("Content-Type"))
		}
		return rec.Body.String()
	}

	if got := get(); got != `{"menu":[]}`+"\n" {
		t.Errorf("before any group: %s", got)
	}
	d.RegisterDashboardGroup("Shop")
	if got := get(); got != `{"menu":[{"title":"Shop","entries":[]}]}`+"\n" {
		t.Errorf("after registering: %s", got)
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
