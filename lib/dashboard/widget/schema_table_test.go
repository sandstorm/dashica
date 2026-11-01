package widget

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
)

func TestSchemaTable_RefusesAnInvalidTableName(t *testing.T) {
	rec := httptest.NewRecorder()
	NewSchemaTable("http_logs; DROP TABLE http_logs").Handler(rendering.Dependencies{}).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/schema", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("GET /schema: %d %s", rec.Code, rec.Body)
	}
	mustContain(t, rec.Body.String(), `invalid table name "http_logs; DROP TABLE http_logs"`)
}
