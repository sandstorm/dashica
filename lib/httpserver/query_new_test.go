// Tests for QueryHandler: a skipped chart.
package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TestHandleQuery_ASkippedChartAnswersWithoutClickHouse(t *testing.T) {
	// no ClickHouse manager: asking it would panic
	qh := QueryHandler{}
	skipped := filter.Diagnostics{Skipped: "pick a host first"}
	state := parseQueryState(t, "time=1h")

	rec := httptest.NewRecorder()
	if err := qh.HandleQuery(sql.New(sql.From("http_logs")), state, skipped, rec, httptest.NewRequest(http.MethodGet, "/query", nil)); err != nil {
		t.Fatalf("HandleQuery: %v", err)
	}
	if rec.Code != http.StatusNoContent || rec.Header().Get("X-Dashica-Diagnostics") != `{"skipped":"pick a host first"}` {
		t.Errorf("status %d, headers %v", rec.Code, rec.Header())
	}

	rec = httptest.NewRecorder()
	if err := qh.HandleDebug(sql.New(sql.From("http_logs")), state, skipped, rec, httptest.NewRequest(http.MethodGet, "/debug", nil)); err != nil {
		t.Fatalf("HandleDebug: %v", err)
	}
	if !strings.Contains(rec.Body.String(), `"diagnostics":{"skipped":"pick a host first"}`) {
		t.Errorf("debug body %s", rec.Body)
	}
}
