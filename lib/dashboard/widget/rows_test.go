// Tests for what a chart's query handler serves the Explore view (/rows, /sql, the Explore gate) and its rows URL
// (Mount).
package widget

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// ask asks the handler of `chart` for `target` (`/rows?time=1h`), Explore enabled or not, with the SQL file
// by_status.sql, on a ClickHouse that is unreachable (a query that gets past the handler's own checks fails with a 500).
func ask(chart withQuery, explore bool, target string) *httptest.ResponseRecorder {
	unreachable := map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1", Database: "default"}}
	deps := rendering.Dependencies{ClickhouseClientManager: clickhouse.NewManager(&config.Config{ClickHouse: unreachable}, zerolog.Nop()), ExploreEnabled: explore, FilterSecret: testSecret,
		FileSystem: fstest.MapFS{"by_status.sql": {Data: []byte("SELECT status, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY status")}}}
	rec := httptest.NewRecorder()
	queryHandler(deps, chart).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func byStatusChart() withQuery {
	return NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count())
}

func TestRows_AnEditedQueryOnlyWhenExploreIsEnabled(t *testing.T) {
	if rec := ask(byStatusChart(), false, "/rows?xsql=SELECT+1"); rec.Code != http.StatusNotFound {
		t.Errorf("Explore off: status %d: %s", rec.Code, rec.Body)
	}

	rec := ask(byStatusChart(), true, "/rows?xsql=SELECT+1")

	// past the gate, without a query state: the unreachable ClickHouse fails it
	if rec.Code != http.StatusInternalServerError || rec.Header().Get("X-Dashica-Rows-Limit") != "100000" || rec.Header().Get("X-Dashica-Sql") != "editable" {
		t.Errorf("Explore on: status %d, headers %v: %s", rec.Code, rec.Header(), rec.Body)
	}
}

func TestRows_AnEmptyEditedQueryIsA400(t *testing.T) {
	if rec := ask(byStatusChart(), true, "/rows?xsql=+%3B+"); rec.Code != http.StatusBadRequest {
		t.Errorf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestRows_TheChartsResultSaysWhetherItsSqlIsEditable(t *testing.T) {
	for _, explore := range []bool{false, true} {
		rec := ask(byStatusChart(), explore, "/rows?time=1h")

		want := map[bool]string{false: "", true: "editable"}[explore]
		if rec.Header().Get("X-Dashica-Sql") != want || rec.Header().Get("X-Dashica-Rows-Limit") != "" {
			t.Errorf("Explore %v: headers %v", explore, rec.Header())
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

func TestSql_IsTheChartsQueryWithItsFiltersWrittenIn(t *testing.T) {
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
			rec := ask(tt.chart, true, "/sql?time=1h&f="+url.QueryEscape(pillOf(t, byStatusChart(), "status", "eq", "it's"))+"&sql="+sqlChip)

			text := rec.Body.String()
			if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") {
				t.Fatalf("status %d, headers %v: %s", rec.Code, rec.Header(), text)
			}
			if strings.Contains(text, "{") || strings.Contains(text, "DASHICA_FILTERS") {
				t.Errorf("a placeholder is left:\n%s", text)
			}
			for _, want := range tt.want {
				if !strings.Contains(strings.ReplaceAll(text, `\'`, "''"), want) {
					t.Errorf("want %q in:\n%s", want, text)
				}
			}
		})
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
