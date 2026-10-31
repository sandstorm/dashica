// Tests for pills against a real ClickHouse (QueryHandler.HandleQuery with filter.Apply's conditions): a quoted value
// compared with a column of another type, a filter button's value among them; the values of a field (HandleValues).
package httpserver

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	testServer "github.com/sandstorm/dashica/lib/testutil/testserver"
)

// statusRows has two rows with a UInt16 `status`, 500 and 200, inside the last hour; each row's `hit` names its status.
// It names `status_rows` as its table, so that it takes the pills on that table.
var statusRows = sql.FromString(`SELECT status, concat('hit-', toString(status)) AS hit
FROM values('status UInt16, timestamp DateTime', (500, now() - 60), (200, now() - 60))
WHERE {{DASHICA_FILTERS}}`).With(sql.Table("default.status_rows"))

// queryStatusRows answers statusRows with the pill on `status` `op` `value`.
func queryStatusRows(t *testing.T, op, value string) (*httptest.ResponseRecorder, error) {
	t.Helper()
	cfg, _ := testServer.LoadTestingConfig(t)
	qh := QueryHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Logger: zerolog.Nop()}
	r := httptest.NewRequest(http.MethodGet, "/query?time=1h", nil)
	state, err := ParseQueryState(r, true)
	if err != nil {
		t.Fatalf("ParseQueryState: %v", err)
	}
	table, ok := filter.TableOf(statusRows, func(string) string { return "default" })
	pill, err := filter.New(table, sql.Field("status"), op, value)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	q, diagnostics := filter.Apply(statusRows, table, ok, []filter.Pill{pill})
	rec := httptest.NewRecorder()
	return rec, qh.HandleQuery(q, state, diagnostics, rec, r)
}

func TestHandleQuery_AQuotedValueMatchesAUInt16Column(t *testing.T) {
	for op, want := range map[string]string{"eq": "hit-500", "ne": "hit-200"} {
		rec, err := queryStatusRows(t, op, "500")
		if err != nil {
			t.Fatalf("%s: %v", op, err)
		}
		other := map[string]string{"hit-500": "hit-200", "hit-200": "hit-500"}[want]
		// the Arrow body is uncompressed, so the strings of its rows are in it as they are
		if body := rec.Body.Bytes(); !bytes.Contains(body, []byte(want)) || bytes.Contains(body, []byte(other)) {
			t.Errorf("%s: want only the row %s", op, want)
		}
	}
}

func TestHandleQuery_AButtonsQuotedValueComparesAUInt16ColumnAsANumber(t *testing.T) {
	// a button writes its value in as a string (`status >= '1000'`); compared as text, '200' and '500' would both be
	// >= '1000', as a number neither is
	for value, want := range map[string][]string{"300": {"hit-500"}, "1000": nil} {
		cfg, _ := testServer.LoadTestingConfig(t)
		qh := QueryHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Logger: zerolog.Nop()}
		r := httptest.NewRequest(http.MethodGet, "/query?time=1h", nil)
		state, _ := ParseQueryState(r, false)
		button, err := filter.NewButton("Status >= …", "status >= ...", value)
		if err != nil {
			t.Fatal(err)
		}
		q, diagnostics := filter.Apply(statusRows, filter.Table{}, false, []filter.Pill{button})
		rec := httptest.NewRecorder()
		if err := qh.HandleQuery(q, state, diagnostics, rec, r); err != nil {
			t.Fatalf("%s: %v", value, err)
		}
		body := rec.Body.Bytes()
		for _, hit := range []string{"hit-500", "hit-200"} {
			if bytes.Contains(body, []byte(hit)) != slices.Contains(want, hit) {
				t.Errorf("status >= '%s': want only %v", value, want)
			}
		}
	}
}

func TestHandleQuery_AQuotedValueThatDoesNotConvertFailsTheQuery(t *testing.T) {
	_, err := queryStatusRows(t, "eq", "abc")
	if err == nil {
		t.Errorf("want ClickHouse's error for 'abc' against a UInt16")
	}
}

func TestHandleQuery_AValueWithQuotesStaysOneLiteral(t *testing.T) {
	_, err := queryStatusRows(t, "eq", `500' OR '1'='1`)
	if err == nil {
		t.Errorf("want the whole text compared as one value (and failing to convert), got %v", err)
	}
}

func TestHandleValues_TheValuesOfAFieldThatContainTheSearch(t *testing.T) {
	cfg, _ := testServer.LoadTestingConfig(t)
	qh := QueryHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Logger: zerolog.Nop()}
	for search, want := range map[string]string{"": `["200","500"]`, "50": `["500"]`, "x": `[]`} {
		r := httptest.NewRequest(http.MethodGet, "/values?time=1h", nil)
		state, err := ParseQueryState(r, true)
		if err != nil {
			t.Fatalf("ParseQueryState: %v", err)
		}
		rec := httptest.NewRecorder()
		if err := qh.HandleValues(sql.Values(statusRows, sql.NewFieldAlias("status"), ValuesLimit), state, search, rec, r); err != nil {
			t.Fatalf("%q: %v", search, err)
		}
		if got := string(bytes.TrimSpace(rec.Body.Bytes())); got != want {
			t.Errorf("%q: %s, want %s", search, got, want)
		}
	}
}
