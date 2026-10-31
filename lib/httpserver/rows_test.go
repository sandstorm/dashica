// Tests for QueryHandler.HandleRows without ClickHouse: a skipped chart; the LIMIT around an edited query.
package httpserver

import (
	"net/http"
	"net/http/httptest"
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
