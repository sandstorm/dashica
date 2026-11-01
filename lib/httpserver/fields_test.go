// Tests for HandleFields without ClickHouse: a chart without computed fields answers its table's columns alone.
package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/clickhouse"
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
