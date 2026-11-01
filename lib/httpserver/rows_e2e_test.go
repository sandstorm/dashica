// Tests for QueryHandler.HandleRows, HandleSql, HandleEditedRows and ConnectionRowsHandler against a real ClickHouse:
// a chart's result, its SQL with its parameters giving the same rows, an edited query read-only and limited, a blank
// Explore tab's query with its parameters on a connection.
package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	testServer "github.com/sandstorm/dashica/lib/testutil/testserver"
)

// caddyRows are three Caddy requests inside the last hour, `id` a UUID (which Arrow cannot carry).
const caddyRows = `values('timestamp DateTime64(3), customer_project String, status UInt16, id UUID',
	(now() - 60, 'sandstorm.shop', 500, '00000000-0000-0000-0000-000000000001'),
	(now() - 120, 'sandstorm.shop', 200, '00000000-0000-0000-0000-000000000002'),
	(now() - 180, 'sandstorm.blog', 500, '00000000-0000-0000-0000-000000000003'))`

// rowsOf answers `query` with the query string `queryString`.
func rowsOf(t *testing.T, query sql.SqlQueryable, queryString string) (*httptest.ResponseRecorder, error) {
	t.Helper()
	cfg, _ := testServer.LoadTestingConfig(t)
	qh := QueryHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Logger: zerolog.Nop(), Config: cfg}
	r := httptest.NewRequest(http.MethodGet, "/rows?"+queryString, nil)
	state, err := ParseQueryState(r)
	if err != nil {
		t.Fatalf("ParseQueryState: %v", err)
	}
	rec := httptest.NewRecorder()
	return rec, qh.HandleRows(query, state, filter.Diagnostics{}, rec, r)
}

func TestHandleRows_AChartsResultWithItsBucketSize(t *testing.T) {
	chart := sql.New(sql.From(caddyRows), sql.Select(sql.AutoBucket("timestamp")), sql.Select(sql.Count()), sql.GroupBy(sql.AutoBucket("timestamp")))

	rec, err := rowsOf(t, chart, "time=1h")

	if err != nil {
		t.Fatalf("HandleRows: %v", err)
	}
	if rec.Header().Get("X-Dashica-Bucket-Size") == "" || rec.Header().Get("X-Dashica-Resolved-Time-Range") == "" {
		t.Errorf("headers %v", rec.Header())
	}
}

// handler is a QueryHandler on the testing config's ClickHouse, Explore and SQL chips enabled.
func handler(t *testing.T) QueryHandler {
	t.Helper()
	cfg, _ := testServer.LoadTestingConfig(t)
	cfg.Explore.Enabled, cfg.Filters.SqlEnabled = true, true
	return QueryHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Logger: zerolog.Nop(), Config: cfg}
}

// editedRows answers the edited query `text` with the parameters `params` on the default connection, with the row
// limit `limit`.
func editedRows(t *testing.T, text string, params map[string]string, limit int) (*httptest.ResponseRecorder, error) {
	t.Helper()
	rec := httptest.NewRecorder()
	return rec, handler(t).HandleEditedRows(sql.New(sql.From(caddyRows)), text, params, limit, rec, httptest.NewRequest(http.MethodGet, "/rows", nil))
}

// chartSql is what HandleSql answers for `chart` with the query state of `r`.
func chartSql(t *testing.T, chart sql.SqlQueryable, r *http.Request) ChartSql {
	t.Helper()
	state, err := ParseQueryState(r)
	if err != nil {
		t.Fatalf("ParseQueryState: %v", err)
	}
	rec := httptest.NewRecorder()
	if err := handler(t).HandleSql(chart, state, filter.Diagnostics{}, rec, r); err != nil {
		t.Fatalf("HandleSql: %v", err)
	}
	var answer ChartSql
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatalf("HandleSql answered %s: %v", rec.Body, err)
	}
	return answer
}

func TestHandleSql_TheSqlWithItsParametersGivesTheRowsOfTheChart(t *testing.T) {
	chart := sql.New(sql.From(caddyRows), sql.Select(sql.Field("id")), sql.Where("status = {status:UInt16}"))
	r := httptest.NewRequest(http.MethodGet, "/sql?time=1h&wp="+url.QueryEscape(`{"status":"500"}`)+"&sql="+url.QueryEscape("customer_project = 'sandstorm.shop'"), nil)
	answer := chartSql(t, chart, r)

	rec, err := editedRows(t, answer.Sql, answer.Parameters, 100)

	if err != nil {
		t.Fatalf("HandleEditedRows: %v", err)
	}
	body := rec.Body.Bytes()
	if !bytes.Contains(body, []byte("00000000-0000-0000-0000-000000000001")) || bytes.Contains(body, []byte("00000000-0000-0000-0000-000000000002")) ||
		bytes.Contains(body, []byte("00000000-0000-0000-0000-000000000003")) {
		t.Errorf("want the row of status 500 in sandstorm.shop only")
	}
}

func TestHandleSql_ItsParametersSentAgainAreTheValuesTheChartBinds(t *testing.T) {
	tests := map[string]struct {
		typ   string
		value string
	}{
		"a String with escape sequences": {typ: "String", value: `a\nb\tc\\d'e`},
		"DateTime64 from an ISO value":   {typ: "DateTime64(3, 'Asia/Tokyo')", value: "2026-10-31T10:00:00.250"},
		"Nullable(String) NULL":          {typ: "Nullable(String)", value: `\N`},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			p := "{v:" + tt.typ + "}"
			chart := sql.FromStringWithoutFilters("SELECT " + p + " = " + p + " AS same, " + p + " AS v")
			r := httptest.NewRequest(http.MethodGet, "/sql?time=1h&wp="+url.QueryEscape(`{"v":"`+strings.ReplaceAll(tt.value, `\`, `\\`)+`"}`), nil)
			answer := chartSql(t, chart, r)
			state, _ := ParseQueryState(r)
			bound := httptest.NewRecorder()
			if err := handler(t).HandleRows(chart, state, filter.Diagnostics{}, bound, r); err != nil {
				t.Fatalf("HandleRows: %v", err)
			}

			edited, err := editedRows(t, answer.Sql, answer.Parameters, 100)

			if err != nil {
				t.Fatalf("HandleEditedRows of %q: %v", answer.Sql, err)
			}
			if !bytes.Equal(edited.Body.Bytes(), bound.Body.Bytes()) {
				t.Errorf("%q with %v answers other rows than the chart", answer.Sql, answer.Parameters)
			}
		})
	}
}

func TestHandleEditedRows_IsReadOnly(t *testing.T) {
	// a statement other than SELECT fails already in the transport's DESCRIBE (<text>), as a syntax error; a SELECT
	// that changes `readonly` back fails with READONLY
	tests := map[string]struct {
		text string
		want string
	}{
		"CREATE":        {text: "CREATE TABLE dashica_edited_query_test (a UInt8) ENGINE = Memory", want: "Syntax error"},
		"INSERT":        {text: "INSERT INTO FUNCTION null('a UInt8') VALUES (1)", want: "Syntax error"},
		"readonly back": {text: "SELECT 1 SETTINGS readonly = 0", want: "READONLY"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := editedRows(t, tt.text, nil, 100)

			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("want %s, got %v", tt.want, err)
			}
		})
	}
}

func TestHandleEditedRows_AnswersExactlyTheLimitWithoutAnError(t *testing.T) {
	// each row's value is the marker, so the uncompressed Arrow holds it once per row
	tests := map[string]string{
		"a query with more rows":           "SELECT 'dashica-row' AS m FROM numbers(1000000) ORDER BY number DESC;",
		"its own SETTINGS cannot lift it":  "SELECT 'dashica-row' AS m FROM numbers(1000000) SETTINGS max_result_rows = 0, result_overflow_mode = 'throw'",
		"a trailing comment ends before )": "SELECT 'dashica-row' AS m FROM numbers(1000000) -- all of them",
		"a subquery runs in full":          "SELECT 'dashica-row' AS m FROM numbers(1000000) WHERE number IN (SELECT number FROM numbers(1000000) WHERE number >= 999000)",
	}
	for name, text := range tests {
		t.Run(name, func(t *testing.T) {
			rec, err := editedRows(t, text, nil, 1000)

			if err != nil {
				t.Fatalf("HandleEditedRows: %v", err)
			}
			if got := bytes.Count(rec.Body.Bytes(), []byte("dashica-row")); rec.Header().Get("X-Dashica-Rows-Limit") != "1000" || got != 1000 {
				t.Errorf("headers %v, %d rows", rec.Header(), got)
			}
		})
	}
}

func TestConnectionRowsHandler_AnswersTheQueryWithItsParametersReadOnly(t *testing.T) {
	cfg, _ := testServer.LoadTestingConfig(t)
	cfg.Explore.Enabled = true
	h := ConnectionRowsHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Config: cfg}
	ask := func(text string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/rows?"+url.Values{"connection": {"default"}, "exploreSql": {text}, "param_v": {"dashica-blank"}}.Encode(), nil))
		return rec
	}

	rec := ask("SELECT {v:String} AS m FROM numbers(3);")
	if rec.Code != http.StatusOK || rec.Header().Get("X-Dashica-Rows-Limit") != "100000" || bytes.Count(rec.Body.Bytes(), []byte("dashica-blank")) != 3 {
		t.Errorf("status %d, headers %v: %s", rec.Code, rec.Header(), rec.Body)
	}
	if rec := ask("SELECT 1 SETTINGS readonly = 0"); rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "READONLY") {
		t.Errorf("readonly back: status %d: %s", rec.Code, rec.Body)
	}
}
