// Tests for the Explore view's rows a chart's query handler serves (rows) and its rows URL (Mount).
package widget

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// askRows asks /rows of `chart` with the query string `query`, Explore enabled or not, with the SQL file by_status.sql,
// on a ClickHouse that is unreachable (a query that gets past the handler's own checks fails with a 500).
func askRows(chart withQuery, explore bool, query string) *httptest.ResponseRecorder {
	unreachable := map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1", Database: "default"}}
	deps := rendering.Dependencies{ClickhouseClientManager: clickhouse.NewManager(&config.Config{ClickHouse: unreachable}, zerolog.Nop()), ExploreEnabled: explore,
		FileSystem: fstest.MapFS{"by_status.sql": {Data: []byte("SELECT status, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY status")}}}
	rec := httptest.NewRecorder()
	queryHandler(deps, chart, httpLogsColumns).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/rows?"+query, nil))
	return rec
}

func byStatusChart() withQuery {
	return NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count())
}

func TestRows_WithoutGroupingOnlyWhenExploreIsEnabled(t *testing.T) {
	if rec := askRows(byStatusChart(), false, "time=1h&grouping=none"); rec.Code != http.StatusNotFound {
		t.Errorf("Explore off: status %d: %s", rec.Code, rec.Body)
	}

	rec := askRows(byStatusChart(), true, "time=1h&grouping=none")

	if rec.Code == http.StatusNotFound || rec.Header().Get("X-Dashica-Rows-Limit") != "100000" || rec.Header().Get("X-Dashica-Grouping") != "removable" {
		t.Errorf("Explore on: status %d, headers %v: %s", rec.Code, rec.Header(), rec.Body)
	}
}

func TestRows_ASqlFileChartHasItsResultOnly(t *testing.T) {
	chart := NewBarVertical(sql.FromFile("by_status.sql")).X(sql.Field("status")).Y(sql.Count())

	if rec := askRows(chart, true, "time=1h&grouping=none"); rec.Code != http.StatusNotFound {
		t.Errorf("without grouping: status %d: %s", rec.Code, rec.Body)
	}
	if rec := askRows(chart, true, "time=1h"); rec.Header().Get("X-Dashica-Grouping") != "" {
		t.Errorf("result: headers %v", rec.Header())
	}
}

func TestRows_TheChartsResultSaysWhetherItsGroupingIsRemovable(t *testing.T) {
	for _, explore := range []bool{false, true} {
		rec := askRows(byStatusChart(), explore, "time=1h")

		want := map[bool]string{false: "", true: "removable"}[explore]
		if rec.Header().Get("X-Dashica-Grouping") != want || rec.Header().Get("X-Dashica-Rows-Limit") != "" {
			t.Errorf("Explore %v: headers %v", explore, rec.Header())
		}
	}
}

func TestRows_AnUnreadableQueryStateIsA400(t *testing.T) {
	if rec := askRows(byStatusChart(), true, "f=status&grouping=none"); rec.Code != http.StatusBadRequest {
		t.Errorf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestMount_AChartHasARowsURLAWidgetWithItsOwnHandlerNone(t *testing.T) {
	_, _, _, page := mountPage(t, NewTable(sql.New(sql.From("caddy_logs"))), pathEcho{})

	if page[0].RowsURL != page[0].DataURL+"/rows" || page[0].DataURL == "" {
		t.Errorf("table: data %q, rows %q", page[0].DataURL, page[0].RowsURL)
	}
	if page[1].DataURL == "" || page[1].RowsURL != "" {
		t.Errorf("handler: data %q, rows %q", page[1].DataURL, page[1].RowsURL)
	}
}
