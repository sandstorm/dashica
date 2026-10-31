// Tests for a chart's table columns against a real ClickHouse (columnsHandler, pillHandler with `column`): the
// columns from the connection's schema, a column's pill signed with the schema's type, a column the table does not
// have refused.
package widget

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	testServer "github.com/sandstorm/dashica/lib/testutil/testserver"
)

// askClickHouse is the answer of `chart`'s handler to `path` on the testing config's ClickHouse, the pills signed
// with testSecret.
func askClickHouse(t *testing.T, chart withQuery, path string) *httptest.ResponseRecorder {
	t.Helper()
	cfg, _ := testServer.LoadTestingConfig(t)
	cfg.Filters.Secret = string(testSecret)
	deps := rendering.Dependencies{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Config: cfg, FileSystem: testFiles}
	rec := httptest.NewRecorder()
	queryHandler(deps, chart).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestColumns_TheColumnsOfTheChartsTableFromTheSchema(t *testing.T) {
	one := NewStats(sql.New(sql.From("system.one")))

	rec := askClickHouse(t, one, "/columns?time=1h")
	var body struct{ Columns []clickhouse.SchemaColumn }
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &body) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if len(body.Columns) != 1 || body.Columns[0].Name != "dummy" || body.Columns[0].Type != "UInt8" {
		t.Errorf("columns %+v", body.Columns)
	}
	if rec.Header().Get("X-Dashica-Resolved-Time-Range") == "" {
		t.Errorf("no resolved time range")
	}
}

func TestPill_AColumnOfTheTableIsSignedWithItsSchemaType(t *testing.T) {
	one := NewStats(sql.New(sql.From("system.one")))

	rec := askClickHouse(t, one, "/pill?column=dummy&op=ne&value=1&type=String")
	var body struct{ Key string }
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	pill, err := filter.Open(testSecret, body.Key)
	if rec.Code != http.StatusOK || err != nil {
		t.Fatalf("%d %s, %v", rec.Code, rec.Body, err)
	}
	want := filter.Pill{Table: filter.Table{Connection: "default", Name: "system.one"}, Field: "dummy", Column: true, Op: "ne", Condition: "(`dummy`) != '1'", Label: "dummy ≠ 1", Value: "1", Type: "UInt8"}
	if pill != want {
		t.Errorf("pill %+v", pill)
	}
	if rec := askClickHouse(t, one, "/pill?column=nope&op=eq&value=1"); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("a column it does not have: %d %s", rec.Code, rec.Body)
	}
}
