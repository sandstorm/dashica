// Tests for what a chart's query handler serves the Explore view (/rows, /sql, 404 while Explore is off) and its rows
// URL (Mount).
package widget

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/httpserver"
)

// ask asks the handler of `chart` for `target` (`/rows?time=1h`), Explore enabled or not, SQL chips enabled, with the
// SQL file by_status.sql, on a ClickHouse that is unreachable (a query that gets past the handler's own checks fails
// with a 500).
func ask(chart withQuery, explore bool, target string) *httptest.ResponseRecorder {
	unreachable := map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1", Database: "default"}}
	deps := rendering.Dependencies{ClickhouseClientManager: clickhouse.NewManager(&config.Config{ClickHouse: unreachable}, zerolog.Nop()), ExploreEnabled: explore, FilterSecret: testSecret, SqlEnabled: true,
		FileSystem: fstest.MapFS{"by_status.sql": {Data: []byte("SELECT status, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY status")}}}
	rec := httptest.NewRecorder()
	queryHandler(deps, chart).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func byStatusChart() withQuery {
	return NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count())
}

func TestRows_AnEditedQueryOnlyWhenExploreIsEnabled(t *testing.T) {
	if rec := ask(byStatusChart(), false, "/rows?exploreSql=SELECT+1"); rec.Code != http.StatusNotFound {
		t.Errorf("Explore off: status %d: %s", rec.Code, rec.Body)
	}

	rec := ask(byStatusChart(), true, "/rows?exploreSql=SELECT+{n:UInt8}&param_n=1")

	// past the gate, without a query state: the unreachable ClickHouse fails it
	if rec.Code != http.StatusInternalServerError || rec.Header().Get("X-Dashica-Rows-Limit") != "100000" {
		t.Errorf("Explore on: status %d, headers %v: %s", rec.Code, rec.Header(), rec.Body)
	}
}

func TestRows_AnEmptyEditedQueryIsA400(t *testing.T) {
	if rec := ask(byStatusChart(), true, "/rows?exploreSql=+%3B+"); rec.Code != http.StatusBadRequest {
		t.Errorf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestRows_TheChartsResultWhetherExploreIsEnabledOrNot(t *testing.T) {
	for _, explore := range []bool{false, true} {
		rec := ask(byStatusChart(), explore, "/rows?time=1h")

		// past every check: the unreachable ClickHouse fails it
		if rec.Code != http.StatusInternalServerError || rec.Header().Get("X-Dashica-Rows-Limit") != "" {
			t.Errorf("Explore %v: status %d, headers %v", explore, rec.Code, rec.Header())
		}
	}
}

func TestRows_AnUnreadableQueryStateIsA400(t *testing.T) {
	if rec := ask(byStatusChart(), true, "/rows?f=status"); rec.Code != http.StatusBadRequest {
		t.Errorf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestSql_OnlyWhenExploreIsEnabled(t *testing.T) {
	if rec := ask(byStatusChart(), false, "/sql?time=1h"); rec.Code != http.StatusNotFound {
		t.Errorf("Explore off: status %d: %s", rec.Code, rec.Body)
	}
}

func TestSql_IsTheChartsQueryWithItsFiltersAndItsParameters(t *testing.T) {
	sqlChip := url.QueryEscape("path LIKE '/api%'")
	tests := map[string]struct {
		chart withQuery
		want  []string
	}{
		"a builder chart": {
			chart: byStatusChart(),
			want:  []string{"http_logs", "(status) = 'it''s'", "AND (path LIKE '/api%')", "GROUP BY"},
		},
		"a SQL file chart": {
			chart: NewBarVertical(sql.FromFile("by_status.sql", sql.Table("http_logs"))).X(sql.Field("status")).Y(sql.Count()),
			want:  []string{"FROM http_logs WHERE", "(status) = 'it''s'", "AND (path LIKE '/api%')", "GROUP BY status"},
		},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			rec := ask(tt.chart, true, "/sql?time=1h&wp="+url.QueryEscape(`{"path":"/api"}`)+"&f="+url.QueryEscape(pillOf(t, byStatusChart(), "status", "eq", "it's"))+"&sql="+sqlChip)

			var got httpserver.ChartSql
			if err := json.Unmarshal(rec.Body.Bytes(), &got); rec.Code != http.StatusOK || err != nil {
				t.Fatalf("status %d (%v): %s", rec.Code, err, rec.Body)
			}
			if strings.Contains(got.Sql, "DASHICA_FILTERS") {
				t.Errorf("the filters are not in:\n%s", got.Sql)
			}
			for _, want := range tt.want {
				if !strings.Contains(strings.ReplaceAll(got.Sql, `\'`, "''"), want) {
					t.Errorf("want %q in:\n%s", want, got.Sql)
				}
			}
			if got.Parameters["path"] != "/api" || got.Parameters["__from"] == "" || got.Parameters["__to"] == "" {
				t.Errorf("parameters %v", got.Parameters)
			}
		})
	}
}

func TestSql_KeepsThePlaceholdersOfItsQuery(t *testing.T) {
	chart := NewBarVertical(sql.New(sql.From("http_logs"), sql.Where("path = {path:String}"))).X(sql.Field("status")).Y(sql.Count())

	rec := ask(chart, true, "/sql?time=1h&wp="+url.QueryEscape(`{"path":"/a'b"}`))

	var got httpserver.ChartSql
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || !strings.Contains(got.Sql, "path = {path:String}") || got.Parameters["path"] != "/a'b" {
		t.Errorf("status %d (%v): %s", rec.Code, err, rec.Body)
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

func TestMount_AChartNamesItsConnectionAWidgetWithItsOwnHandlerNone(t *testing.T) {
	_, _, _, page := mountPage(t, NewTable(sql.New(sql.From("caddy_logs"))), NewTable(sql.New(sql.From("audit"), sql.OnDatabase("logs"))), pathEcho{})

	if got := []string{page[0].Connection, page[1].Connection, page[2].Connection}; !slices.Equal(got, []string{"default", "logs", ""}) {
		t.Errorf("connections %q", got)
	}
}
