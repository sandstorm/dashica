package explore

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// handleSchema serves tables + columns + types for the "default" server, so the
// editor's field/column pickers know what is queryable. It is the canonical
// clickhouse.IntrospectedSchema (tables, per-table columns with types, common
// columns) served verbatim.
func (e *exploreImpl) handleSchema(w http.ResponseWriter, r *http.Request) error {
	client, err := e.deps.ClickhouseClientManager.GetClient("default")
	if err != nil {
		return fmt.Errorf("fetching clickhouse client: %w", err)
	}

	schema, err := client.IntrospectSchema(r.Context())
	if err != nil {
		return fmt.Errorf("introspecting schema: %w", err)
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(schema)
}
