// Tests for the filters a chart's query handler applies (queryHandler, applyFilters).
package widget

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// debugged is what a chart's /debug answers about its filters: the query, the bound parameters, the Diagnostics.
type debugged struct {
	status      int
	diagnostics string
	query       string
	params      map[string]string
}

// httpLogsColumns is a column source with the table http_logs on every server.
func httpLogsColumns(_ context.Context, _, table string) ([]string, error) {
	if table == "http_logs" {
		return []string{"timestamp", "status", "path"}, nil
	}
	return nil, nil
}

// debug asks /debug of `chart` with the query string `query`, its base table's columns from httpLogsColumns, on a
// ClickHouse that is unreachable (the EXPLAINs of /debug fail and stay unchecked).
func debug(t *testing.T, chart withQuery, query string) debugged {
	t.Helper()
	unreachable := map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1", Database: "default"}}
	deps := rendering.Dependencies{ClickhouseClientManager: clickhouse.NewManager(&config.Config{ClickHouse: unreachable}, zerolog.Nop())}
	rec := httptest.NewRecorder()
	queryHandler(deps, chart, httpLogsColumns).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/debug?"+query, nil))
	got := debugged{status: rec.Code, diagnostics: rec.Header().Get("X-Dashica-Diagnostics")}
	if rec.Code != http.StatusOK {
		return got
	}
	var body struct {
		Query string
		Stats struct {
			Parameters map[string]string `json:"parameters"`
		}
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("debug body %s: %v", rec.Body, err)
	}
	got.query, got.params = body.Query, body.Stats.Parameters
	return got
}

func TestQueryHandler_AChartInterpretsItsOwnFieldsAndItsTablesColumns(t *testing.T) {
	bar := NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.JsonExtractString("attrs", "host")).Y(sql.Count())

	got := debug(t, bar, "time=1h&f=host:ne:a:b&f=status:eq:500&f=level:eq:error")

	if got.diagnostics != `{"ignored":["level"]}` {
		t.Errorf("diagnostics %q", got.diagnostics)
	}
	if want := "(JSONExtractString(attrs, 'host')) != {__f0:String} AND (status) = {__f1:String}"; !strings.Contains(got.query, want) {
		t.Errorf("query lacks %s:\n%s", want, got.query)
	}
	// the ignored filter's value is bound as well
	if got.params["__f0"] != "a:b" || got.params["__f1"] != "500" || got.params["__f2"] != "error" || got.params["__from"] == "" {
		t.Errorf("params: %v", got.params)
	}
}

func TestQueryHandler_TheSameIdMeansWhatEachChartSaysIt(t *testing.T) {
	// two charts alias different expressions as level; each compares its own
	logs := sql.New(sql.From("http_logs"))
	byLevel := NewBarVertical(logs).X(sql.Enum("level")).Y(sql.Count())
	byLevelOverTime := NewTimeHeatmapOrdinal(logs).X(sql.Timestamp15Min()).Y(sql.Field("lower(severity)").WithAlias("level"))

	if got := debug(t, byLevel, "time=1h&f=level:eq:error"); !strings.Contains(got.query, "(level::String) = {__f0:String}") {
		t.Errorf("bar:\n%s", got.query)
	}
	if got := debug(t, byLevelOverTime, "time=1h&f=level:eq:error"); !strings.Contains(got.query, "(lower(severity)) = {__f0:String}") {
		t.Errorf("heatmap:\n%s", got.query)
	}
}

func TestQueryHandler_ASqlFileChartInterpretsItsOwnOutputColumns(t *testing.T) {
	byHost := NewBarVertical(sql.FromString("SELECT host, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY host")).
		X(sql.NewFieldAlias("host")).Y(sql.NewFieldAlias("cnt"))

	got := debug(t, byHost, "time=1h&f=status:eq:500&f=host:eq:shop")

	if got.diagnostics != `{"ignored":["status"]}` {
		t.Errorf("diagnostics %q", got.diagnostics)
	}
	if !strings.Contains(got.query, "((host) = {__f1:String})") {
		t.Errorf("query:\n%s", got.query)
	}
}

func TestQueryHandler_ATableInterpretsItsGroupByFieldsAsItSelectsThem(t *testing.T) {
	table := NewTable(sql.New(sql.From("http_logs"),
		sql.Select(sql.JsonExtractString("attrs", "host")),
		sql.Select(sql.Field("sum(bytes)").WithAlias("bytes")),
		sql.GroupBy(sql.Field("host")),
	))

	got := debug(t, table, "time=1h&f=host:eq:shop&f=bytes:eq:1")

	if !strings.Contains(got.query, "(JSONExtractString(attrs, 'host')) = {__f0:String}") || got.diagnostics != `{"ignored":["bytes"]}` {
		t.Errorf("diagnostics %q, query:\n%s", got.diagnostics, got.query)
	}
}

// ownFilters is a chart that interprets the filters itself: it skips without a host filter.
type ownFilters struct{ *BarVertical }

func (c ownFilters) ApplyFilters(q sql.SqlQueryable, filters []filter.Filter) (sql.SqlQueryable, filter.Diagnostics) {
	for i, f := range filters {
		if f.ID == "host" {
			return q.With(sql.Where(filter.Condition(i, f, "hostname"))), filter.Diagnostics{}
		}
	}
	return q, filter.Diagnostics{Skipped: "pick a host"}
}

func TestQueryHandler_AChartWithApplyFiltersDecidesItself(t *testing.T) {
	chart := ownFilters{NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count())}

	if got := debug(t, chart, "time=1h&f=status:eq:500&f=host:eq:a"); !strings.Contains(got.query, "(hostname) = {__f1:String}") || strings.Contains(got.query, "__f0:") {
		t.Errorf("query:\n%s", got.query)
	}

	unreachable := rendering.Dependencies{ClickhouseClientManager: clickhouse.NewManager(&config.Config{}, zerolog.Nop())}
	rec := httptest.NewRecorder()
	queryHandler(unreachable, chart, httpLogsColumns).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/query?time=1h", nil))
	if rec.Code != http.StatusNoContent || rec.Header().Get("X-Dashica-Diagnostics") != `{"skipped":"pick a host"}` {
		t.Errorf("skipped: status %d, headers %v, body %s", rec.Code, rec.Header(), rec.Body)
	}
}

func TestQueryHandler_AQueryThatSkipsFiltersIgnoresAll(t *testing.T) {
	got := debug(t, NewBarVertical(sql.New(sql.From("http_logs"), sql.SkipFilters())).X(sql.Field("status")).Y(sql.Count()), "time=1h&f=status:eq:500")
	if got.diagnostics != `{"ignored":["status"]}` || strings.Contains(got.query, "__f0:") {
		t.Errorf("want everything ignored: %+v", got)
	}
}

func TestQueryHandler_AFailingDescribeFailsTheChart(t *testing.T) {
	failing := func(context.Context, string, string) ([]string, error) { return nil, context.DeadlineExceeded }
	chart := NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count())
	rec := httptest.NewRecorder()
	queryHandler(rendering.Dependencies{}, chart, failing).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/query?time=1h&f=path:eq:/", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status %d", rec.Code)
	}
}

func TestQueryHandler_AnUnknownOpIsABadRequest(t *testing.T) {
	got := debug(t, NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("host")).Y(sql.Count()), "time=1h&f=host:like:shop")
	if got.status != http.StatusBadRequest {
		t.Errorf("status %d", got.status)
	}
}
