package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"

	"github.com/sandstorm/dashica/lib/clickhouse"
)

// SchemaHandler answers `GET /schema.json?connection=<name>` with the clickhouse.Schema of that connection of
// dashica_config (the Schema view's tree, docs/2026-10-30-perspective.md §4.8), kept per connection once asked
// (Client.Schema); `&refresh=1` asks ClickHouse again. 404 while explore.enabled is off (ErrExploreNotEnabled, before
// any query) and for a connection dashica_config does not name.
type SchemaHandler struct {
	ClickhouseClientManager *clickhouse.Manager
	// ExploreEnabled: it answers (explore.enabled); the Schema view is part of Explore.
	ExploreEnabled bool
}

func (h SchemaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.ExploreEnabled {
		http.Error(w, ErrExploreNotEnabled.Error(), http.StatusNotFound)
		return
	}
	args := r.URL.Query()
	connection := args.Get("connection")
	if !slices.Contains(h.ClickhouseClientManager.Connections(), connection) {
		http.Error(w, fmt.Sprintf("no connection %q in dashica_config", connection), http.StatusNotFound)
		return
	}
	client, err := h.ClickhouseClientManager.GetClient(connection)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	schema, err := client.Schema(r.Context(), args.Get("refresh") == "1")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(schema)
}
