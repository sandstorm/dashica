// Tests for QueryHandler.HandleRows, HandleSql and HandleEditedRows without ClickHouse: a skipped chart; the LIMIT
// around an edited query; its `param_<name>` keys (EditedParameters); the Explore handlers while Explore is off.
package httpserver

import (
	"errors"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TestHandleRows_ASkippedChartAnswers204WithoutClickHouse(t *testing.T) {
	// no ClickHouse manager: asking it would panic
	qh := QueryHandler{}
	rec := httptest.NewRecorder()

	err := qh.HandleRows(sql.New(sql.From("http_logs")), parseQueryState(t, "time=1h"), filter.Diagnostics{Skipped: "pick a host first"}, rec, httptest.NewRequest(http.MethodGet, "/rows", nil))

	if err != nil {
		t.Fatalf("HandleRows: %v", err)
	}
	if rec.Code != http.StatusNoContent || rec.Header().Get("X-Dashica-Diagnostics") != `{"skipped":"pick a host first"}` {
		t.Errorf("status %d, headers %v", rec.Code, rec.Header())
	}
}

func TestLimited_IsALimitAroundTheTextOnLinesOfItsOwn(t *testing.T) {
	got := limited("SELECT 1 SETTINGS max_result_rows = 0 -- all", 1000)

	if want := "SELECT * FROM (\nSELECT 1 SETTINGS max_result_rows = 0 -- all\n) LIMIT 1000"; got != want {
		t.Errorf("limited =\n%s\nwant\n%s", got, want)
	}
}

func TestEditedParameters_AreTheParamKeysOfTheRequest(t *testing.T) {
	values := url.Values{"exploreSql": {"SELECT {v:String}"}, "param___from": {"1761724800"}, "param_v": {"a'b", "second"}, "param_": {"x"}, "time": {"1h"}}

	got := EditedParameters(values)

	if want := map[string]string{"__from": "1761724800", "v": "a'b"}; !maps.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestExploreHandlers_AnswerErrExploreNotEnabledBeforeAnyQuery(t *testing.T) {
	// no ClickHouse manager: a handler that got past its check would panic
	qh := QueryHandler{}
	chart := sql.New(sql.From("http_logs"))
	r := httptest.NewRequest(http.MethodGet, "/sql?time=1h", nil)

	if err := qh.HandleSql(chart, QueryState{}, filter.Diagnostics{}, httptest.NewRecorder(), r); !errors.Is(err, ErrExploreNotEnabled) {
		t.Errorf("HandleSql: %v", err)
	}
	if err := qh.HandleEditedRows(chart, "SELECT 1", nil, 10, httptest.NewRecorder(), r); !errors.Is(err, ErrExploreNotEnabled) {
		t.Errorf("HandleEditedRows: %v", err)
	}
}
