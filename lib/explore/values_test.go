package explore

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The values endpoint interpolates table/column into SQL, so it validates both
// identifiers before any DB access. These cases are reachable without a
// ClickHouse connection.
func TestHandleValues_RequiresParams(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodGet, "/explore/api/values?table=full_logs", nil)
	if err := e.handleValues(httptest.NewRecorder(), req); err == nil {
		t.Fatal("expected error when column missing")
	}
}

func TestHandleValues_RejectsInvalidIdentifier(t *testing.T) {
	e := newTestExplore()
	req := httptest.NewRequest(http.MethodGet, "/explore/api/values?table=full_logs&column=a%60b", nil)
	err := e.handleValues(httptest.NewRecorder(), req)
	if err == nil || err.Error() != "values: invalid table or column identifier" {
		t.Fatalf("expected invalid-identifier error, got %v", err)
	}
}
