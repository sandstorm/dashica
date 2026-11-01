// Tests for a chart's fields against a real ClickHouse (fieldsHandler, pillHandler with `column`): the columns from
// the connection's schema and the computed fields' types from a DESCRIBE, a column's pill signed, a column the table
// does not have refused.
package widget

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
	deps := rendering.Dependencies{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Config: cfg, FilterService: filter.NewFilterService(cfg), FileSystem: testFiles}
	rec := httptest.NewRecorder()
	queryHandler(deps, chart).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestFields_TheColumnsFromTheSchemaTheComputedFieldsDescribed(t *testing.T) {
	builder := NewBarVertical(sql.New(sql.From("system.one"))).X(sql.Field("toString(dummy)").WithAlias("shown")).Y(sql.Count()).Fill(sql.Field("dummy"))
	file := NewBarVertical(sql.FromString("SELECT toUInt16(dummy) + 1 AS next, count() AS cnt FROM system.one WHERE {{DASHICA_FILTERS}} GROUP BY next").With(sql.Table("system.one"))).
		X(sql.NewFieldAlias("next")).Y(sql.NewFieldAlias("cnt"))
	for name, tt := range map[string]struct {
		chart withQuery
		want  string
	}{
		"a builder query": {builder, `{"columns":[{"name":"dummy","type":"UInt8"}],"computed":[{"name":"shown","type":"String"}]}`},
		"a SQL string":    {file, `{"columns":[{"name":"dummy","type":"UInt8"}],"computed":[{"name":"next","type":"UInt32"}]}`},
	} {
		rec := askClickHouse(t, tt.chart, "/fields?time=1h")
		if got := strings.TrimSpace(rec.Body.String()); rec.Code != http.StatusOK || got != tt.want {
			t.Errorf("%s: %d %s, want %s", name, rec.Code, got, tt.want)
		}
		if rec.Header().Get("X-Dashica-Resolved-Time-Range") == "" {
			t.Errorf("%s: no resolved time range", name)
		}
	}
}

func TestPill_AColumnOfTheTableIsSigned(t *testing.T) {
	one := NewStats(sql.New(sql.From("system.one")))

	rec := askClickHouse(t, one, "/pill?column=dummy&op=ne&value=1")
	var body struct{ Key string }
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	pill, err := testDeps().FilterService.Open(body.Key)
	if rec.Code != http.StatusOK || err != nil {
		t.Fatalf("%d %s, %v", rec.Code, rec.Body, err)
	}
	want := filter.Pill{Table: filter.Table{Connection: "default", Name: "system.one"}, Field: "dummy", Column: true, Op: "ne", Condition: "(`dummy`) != '1'", Label: "dummy ≠ 1", Value: "1"}
	if pill != want {
		t.Errorf("pill %+v", pill)
	}
	if rec := askClickHouse(t, one, "/pill?column=nope&op=eq&value=1"); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("a column it does not have: %d %s", rec.Code, rec.Body)
	}
}
