package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// Fields is what HandleFields answers: the fields a chart filters its table by, each with its ClickHouse type
// ("DateTime64(3)", "LowCardinality(String)"), by which the filter bar offers the ops it allows
// (docs/2026-10-28-workbench.md §3.15 D39).
type Fields struct {
	// Columns are the columns of the chart's table as the schema of its connection has them.
	Columns []clickhouse.ResultColumn `json:"columns"`
	// Computed are the chart's filterable fields that are more than a column of its table, by alias.
	Computed []clickhouse.ResultColumn `json:"computed"`
}

// HandleFields answers `columns` (the chart's table's) and the types of the fields `computed` names, their query
// `typesQuery` (sql.FieldTypes of the chart's query, one column per field in that order) described by ClickHouse
// (`DESCRIBE (…)`, which reads no rows) in the time range of `state` as HandleQuery fills in a chart's, as the JSON
// of Fields, with the resolved time range in X-Dashica-Resolved-Time-Range as a chart's answer has it (the filter
// bar's default for a time). Without computed fields it asks ClickHouse nothing.
func (qh QueryHandler) HandleFields(columns []clickhouse.SchemaColumn, typesQuery sql.SqlQueryable, computed []string, state QueryState, w http.ResponseWriter, r *http.Request) error {
	answer := Fields{Columns: make([]clickhouse.ResultColumn, 0, len(columns)), Computed: make([]clickhouse.ResultColumn, 0, len(computed))}
	for _, column := range columns {
		answer.Columns = append(answer.Columns, clickhouse.ResultColumn{Name: column.Name, Type: column.Type})
	}
	if len(computed) == 0 {
		timeRange, err := state.ResolveTimeRange(time.Now())
		if err != nil {
			return err
		}
		WriteResolvedTimeRange(w, timeRange)
	} else {
		p, err := qh.prepare(typesQuery, state)
		if err != nil {
			return err
		}
		described, err := p.client.Describe(r.Context(), p.query, p.opts)
		if err != nil {
			return fmt.Errorf("clickhouse describe: %w", err)
		}
		if len(described) != len(computed) {
			return fmt.Errorf("clickhouse described %d columns for %d fields", len(described), len(computed))
		}
		// by position: a field without alias is named as ClickHouse formats its expression
		for i, name := range computed {
			answer.Computed = append(answer.Computed, clickhouse.ResultColumn{Name: name, Type: described[i].Type})
		}
		p.writeHeaders(w)
	}
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(answer)
}
