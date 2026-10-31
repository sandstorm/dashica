package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// ValuesLimit is the number of values `<dataUrl>/values` answers at most (docs/2026-10-28-workbench.md §3.14 D15).
const ValuesLimit = 100

// HandleValues answers the values query `valuesQuery` (sql.Values of a chart's query, the pills on its table in it)
// filtered by `state` as HandleQuery filters a chart, `search` bound to sql.ValuesSearchParameter, as a JSON array
// of strings (`["shop-1","shop-2"]`): what the filter bar's "add filter" offers for a field.
func (qh QueryHandler) HandleValues(valuesQuery sql.SqlQueryable, state QueryState, search string, w http.ResponseWriter, r *http.Request) error {
	p, err := qh.prepare(valuesQuery, state)
	if err != nil {
		return err
	}
	p.opts.Parameters[sql.ValuesSearchParameter] = search
	result, err := clickhouse.QueryJSON[struct {
		Value string `json:"__value"`
	}](r.Context(), p.client, p.query, p.opts)
	if err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}
	values := make([]string, 0, len(result.Data))
	for _, row := range result.Data {
		values = append(values, row.Value)
	}
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(values)
}
