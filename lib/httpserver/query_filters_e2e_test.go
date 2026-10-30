// Tests for structured filters against a real ClickHouse (QueryHandler.HandleQuery with filter.Apply's conditions).
package httpserver

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	testServer "github.com/sandstorm/dashica/lib/testutil/testserver"
)

// statusRows has two rows with a UInt16 `status`, 500 and 200, inside the last hour; each row's `hit` names its status.
const statusRows = `SELECT status, concat('hit-', toString(status)) AS hit
FROM values('status UInt16, timestamp DateTime', (500, now() - 60), (200, now() - 60))
WHERE {{DASHICA_FILTERS}}`

// queryStatusRows answers statusRows with the query string `query`, the chart's own output column `status` its field.
func queryStatusRows(t *testing.T, query string) (*httptest.ResponseRecorder, error) {
	t.Helper()
	cfg, _ := testServer.LoadTestingConfig(t)
	qh := QueryHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Logger: zerolog.Nop()}
	r := httptest.NewRequest(http.MethodGet, "/query?"+query, nil)
	state, err := ParseQueryState(r)
	if err != nil {
		t.Fatalf("ParseQueryState: %v", err)
	}
	q, diagnostics, err := filter.Apply(context.Background(), sql.FromString(statusRows), []sql.SqlField{sql.NewFieldAlias("status")}, state.Filters, nil)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	rec := httptest.NewRecorder()
	return rec, qh.HandleQuery(q, state, diagnostics, rec, r)
}

func TestHandleQuery_AStringValueMatchesAUInt16Column(t *testing.T) {
	for query, want := range map[string]string{"time=1h&f=status:eq:500": "hit-500", "time=1h&f=status:ne:500": "hit-200"} {
		rec, err := queryStatusRows(t, query)
		if err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		other := map[string]string{"hit-500": "hit-200", "hit-200": "hit-500"}[want]
		// the Arrow body is uncompressed, so the strings of its rows are in it as they are
		if body := rec.Body.Bytes(); !bytes.Contains(body, []byte(want)) || bytes.Contains(body, []byte(other)) {
			t.Errorf("%s: want only the row %s", query, want)
		}
	}
}

func TestHandleQuery_AValueOfAnIgnoredFilterIsBoundUnnamed(t *testing.T) {
	rec, err := queryStatusRows(t, "time=1h&f=host:eq:a&f=status:eq:500")
	if err != nil {
		t.Fatalf("ClickHouse refuses the unnamed __f0: %v", err)
	}
	if got := rec.Header().Get("X-Dashica-Diagnostics"); got != `{"ignored":["host"]}` {
		t.Errorf("diagnostics %q", got)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("hit-500")) {
		t.Errorf("want the row hit-500")
	}
}

func TestHandleQuery_AValueThatDoesNotConvertFailsWithTypeMismatch(t *testing.T) {
	_, err := queryStatusRows(t, "time=1h&f=status:eq:abc")
	if err == nil || !strings.Contains(err.Error(), "TYPE_MISMATCH") {
		t.Errorf("want ClickHouse's TYPE_MISMATCH, got %v", err)
	}
}
