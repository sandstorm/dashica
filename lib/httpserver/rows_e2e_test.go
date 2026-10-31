// Tests for QueryHandler.HandleRows against a real ClickHouse: a chart's result and its rows without grouping, in plain
// Arrow types.
package httpserver

import (
	"bytes"
	"net/http"
	"net/http/httptest"
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
	qh := QueryHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Logger: zerolog.Nop()}
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

func TestHandleRows_RowsWithoutGroupingAreTheOriginalColumnsNewestFirst(t *testing.T) {
	chart := sql.New(sql.From(caddyRows), sql.Select(sql.Field("status")), sql.Select(sql.Count()), sql.GroupBy(sql.Field("status")))
	rows, _ := sql.Ungrouped(chart, 1)

	rec, err := rowsOf(t, rows, "time=1h")

	if err != nil {
		t.Fatalf("HandleRows: %v", err)
	}
	body := rec.Body.Bytes()
	// the newest row only, its UUID as its text, its project as stored
	if !bytes.Contains(body, []byte("00000000-0000-0000-0000-000000000001")) || bytes.Contains(body, []byte("00000000-0000-0000-0000-000000000002")) {
		t.Errorf("want the newest row only")
	}
	if !bytes.Contains(body, []byte("sandstorm.shop")) {
		t.Errorf("want the original customer_project")
	}
}
