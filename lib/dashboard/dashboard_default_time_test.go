// Tests for the page's default time range in its widgets' handlers: a request without `time` (the page's URL leaves the
// default out) is for the dashboard's DefaultTimeRange, else 24h; one with `time` for that.
package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// windowHours is the length in hours of the window the chart of `d` (mounted at "/p/shop", its chart's handlers at
// "/p/shop/api/1") queries for `query`, as its /sql gives the window's parameters; no ClickHouse is asked.
func windowHours(t *testing.T, d Dashboard, query string) int64 {
	t.Helper()
	mux := http.NewServeMux()
	cfg := &config.Config{
		ClickHouse: map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1", Database: "default"}},
		Filters:    config.FiltersConfig{Secret: string(testSecret)},
		Explore:    config.ExploreConfig{Enabled: true},
	}
	ctx := &rendering.DashboardContext{MainMenu: &[]rendering.MenuGroup{}, CurrentHandlerUrl: "/p/shop", Deps: rendering.Dependencies{
		ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()),
		Config:                  cfg,
		FilterService:           filter.NewFilterService(cfg),
	}}
	if _, err := d.CollectHandlers(ctx, handler_collector.NewValidatingCollector(mux, zerolog.Nop()).Nested("/p/shop")); err != nil {
		t.Fatalf("CollectHandlers: %v", err)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/p/shop/api/1/sql"+query, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/sql%s: status %d: %s", query, rec.Code, rec.Body)
	}
	var chart httpserver.ChartSql
	if err := json.Unmarshal(rec.Body.Bytes(), &chart); err != nil {
		t.Fatalf("/sql%s: %v", query, err)
	}
	from, errFrom := strconv.ParseInt(chart.Parameters["__from"], 10, 64)
	to, errTo := strconv.ParseInt(chart.Parameters["__to"], 10, 64)
	if errFrom != nil || errTo != nil {
		t.Fatalf("/sql%s: parameters %v", query, chart.Parameters)
	}
	return (to - from) / 3600
}

func TestWidgetHandlers_TakeThePagesDefaultTimeRange(t *testing.T) {
	chart := widget.NewTimeBar(sql.New(sql.From("http_logs"))).X(sql.Timestamp15Min()).Y(sql.Count()).Title("Requests")
	tests := map[string]struct {
		dashboard *Builder
		query     string
		want      int64
	}{
		"without time, the dashboard's default": {dashboard: New().DefaultTimeRange("168h"), query: "", want: 168},
		"with time, the given one":              {dashboard: New().DefaultTimeRange("168h"), query: "?time=1h", want: 1},
		"without time on a page declaring none": {dashboard: New(), query: "", want: 24},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			if got := windowHours(t, tt.dashboard.Widget(chart), tt.query); got != tt.want {
				t.Errorf("window %dh, want %dh", got, tt.want)
			}
		})
	}
}
