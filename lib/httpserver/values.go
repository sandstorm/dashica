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

// Values is what HandleValues answers: the type of a field and some of its values.
type Values struct {
	// Type is the field's ClickHouse type as the answer's metadata reports it (sql.ValuesTypeColumn:
	// "DateTime64(3)", "LowCardinality(String)"), by which the filter bar offers the ops it allows.
	Type string `json:"type"`
	// Values are the values as text, sorted (`["shop-1","shop-2"]`).
	Values []string `json:"values"`
}

// HandleValues answers the values query `valuesQuery` (sql.Values of a chart's query, the pills on its table in it)
// filtered by `state` as HandleQuery filters a chart, `search` bound to sql.ValuesSearchParameter, as the JSON of
// Values, with the resolved time range in X-Dashica-Resolved-Time-Range as a chart's answer has it (the filter bar's
// default for a time): what the filter bar's "add filter" offers for a field.
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
	answer := Values{Values: make([]string, 0, len(result.Data))}
	for _, column := range result.Meta {
		if column.Name == sql.ValuesTypeColumn {
			answer.Type = column.Type
		}
	}
	for _, row := range result.Data {
		answer.Values = append(answer.Values, row.Value)
	}
	p.writeHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(answer)
}
