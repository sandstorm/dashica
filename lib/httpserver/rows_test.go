// Tests for QueryHandler.HandleRows, HandleSql, HandleEditedRows and ConnectionRowsHandler without ClickHouse: a
// skipped chart; the LIMIT around an edited query; its `param_<name>` keys (EditedParameters); the Explore handlers
// while Explore is off; a blank Explore tab's query on a connection not in the config, and an empty one.
package httpserver

import (
	"errors"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
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

// askConnectionRows is what a ConnectionRowsHandler on a config with the connection "default" (whose ClickHouse is not
// asked: every case answers before) answers `target`.
func askConnectionRows(exploreEnabled bool, target string) *httptest.ResponseRecorder {
	cfg := &config.Config{ClickHouse: map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1"}}}
	h := ConnectionRowsHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), ExploreEnabled: exploreEnabled}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestConnectionRowsHandler_AnswersNotFoundWhileExploreIsOff(t *testing.T) {
	rec := askConnectionRows(false, "/rows?connection=default&exploreSql=SELECT+1")
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "explore.enabled") {
		t.Errorf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestConnectionRowsHandler_AnswersNotFoundForAConnectionNotInTheConfig(t *testing.T) {
	for _, target := range []string{"/rows?connection=logs&exploreSql=SELECT+1", "/rows?exploreSql=SELECT+1"} {
		rec := askConnectionRows(true, target)
		if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "dashica_config") {
			t.Errorf("%s: status %d: %s", target, rec.Code, rec.Body)
		}
	}
}

func TestConnectionRowsHandler_AnswersBadRequestForAnEmptyQuery(t *testing.T) {
	for _, target := range []string{"/rows?connection=default", "/rows?connection=default&exploreSql=+%3B+"} {
		rec := askConnectionRows(true, target)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "empty") {
			t.Errorf("%s: status %d: %s", target, rec.Code, rec.Body)
		}
	}
}
