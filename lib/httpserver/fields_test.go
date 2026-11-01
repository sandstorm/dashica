// Tests for HandleFields without ClickHouse: a chart without computed fields answers its table's columns alone; the
// DESCRIBE of its computed fields takes no SQL chips.
package httpserver

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TestHandleFields_WithoutComputedFieldsAsksClickHouseNothing(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/fields?time=1h", nil)
	state, err := ParseQueryState(r)
	if err != nil {
		t.Fatal(err)
	}
	columns := []clickhouse.SchemaColumn{{Name: "host", Type: "LowCardinality(String)", Comment: "the host"}}
	rec := httptest.NewRecorder()
	// no ClickHouse client: one asked would fail
	if err := (QueryHandler{}).HandleFields(columns, sql.FieldTypes(sql.New(sql.From("http_logs")), nil), nil, state, rec, r); err != nil {
		t.Fatal(err)
	}
	if got, want := strings.TrimSpace(rec.Body.String()), `{"columns":[{"name":"host","type":"LowCardinality(String)"}],"computed":[]}`; got != want {
		t.Errorf("%s, want %s", got, want)
	}
	if rec.Header().Get("X-Dashica-Resolved-Time-Range") == "" {
		t.Errorf("no resolved time range")
	}
}

func TestHandleFields_TakesNoSqlChips(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/fields?time=1h&sql=nonsense", nil)
	state, err := ParseQueryState(r)
	if err != nil {
		t.Fatal(err)
	}
	// filters.sqlEnabled off: a chip that reached the DESCRIBE would be ErrSqlNotEnabled
	cfg := &config.Config{ClickHouse: map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1", Database: "default"}}}
	qh := QueryHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Config: cfg}
	host := sql.Field("lower(host_name)").WithAlias("host")
	err = qh.HandleFields(nil, sql.FieldTypes(sql.New(sql.From("http_logs")), []sql.SqlField{host}), []string{"host"}, state, httptest.NewRecorder(), r)
	// the ClickHouse of cfg is unreachable: the request got to the DESCRIBE
	if err == nil || errors.Is(err, ErrSqlNotEnabled) || !strings.Contains(err.Error(), "clickhouse describe") {
		t.Errorf("%v", err)
	}
}
