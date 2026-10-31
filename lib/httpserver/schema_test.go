package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
)

// askSchema is what a SchemaHandler on a config with the connection "default" (whose ClickHouse is not asked:
// every case answers before) answers `target`.
func askSchema(exploreEnabled bool, target string) *httptest.ResponseRecorder {
	cfg := &config.Config{ClickHouse: map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1"}}}
	h := SchemaHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), ExploreEnabled: exploreEnabled}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestSchemaHandler_AnswersNotFoundWhileExploreIsOff(t *testing.T) {
	rec := askSchema(false, "/schema.json?connection=default")
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "explore.enabled") {
		t.Errorf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestSchemaHandler_AnswersNotFoundForAConnectionNotInTheConfig(t *testing.T) {
	for _, target := range []string{"/schema.json?connection=logs", "/schema.json"} {
		rec := askSchema(true, target)
		if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "dashica_config") {
			t.Errorf("%s: status %d: %s", target, rec.Code, rec.Body)
		}
	}
}
