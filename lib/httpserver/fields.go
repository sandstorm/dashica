package httpserver

import (
	"encoding/json"
	"errors"
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

// HandleFields answers `columns` (the chart's table's) and the types of its `computed` fields, from `DESCRIBE (…)`
// (which reads no rows) of sql.FieldTypes of the chart's `query` (fieldTypes) in the time range of `state` as
// HandleQuery fills in a chart's, without its SQL chips (they change no type), as the JSON of Fields, with the resolved
// time range in X-Dashica-Resolved-Time-Range as a chart's answer has it (the filter bar's default for a time). A
// computed field ClickHouse cannot describe has no type in the answer (logged), the columns and the other fields keep
// theirs. Without computed fields it asks ClickHouse nothing.
func (qh QueryHandler) HandleFields(columns []clickhouse.SchemaColumn, query sql.SqlQueryable, computed []sql.SqlField, state QueryState, w http.ResponseWriter, r *http.Request) error {
	timeRange, err := state.ResolveTimeRange(time.Now())
	if err != nil {
		return err
	}
	answer := Fields{Columns: make([]clickhouse.ResultColumn, 0, len(columns)), Computed: []clickhouse.ResultColumn{}}
	for _, column := range columns {
		answer.Columns = append(answer.Columns, clickhouse.ResultColumn{Name: column.Name, Type: column.Type})
	}
	if len(computed) > 0 {
		state.Sql = nil
		described, err := fieldTypes(computed, func(fields []sql.SqlField) ([]clickhouse.ResultColumn, error) {
			p, err := qh.prepare(sql.FieldTypes(query, fields), state)
			if err != nil {
				return nil, err
			}
			return p.client.Describe(r.Context(), p.query, p.opts)
		})
		if err != nil {
			qh.Logger.Warn().Err(err).Msg("describing a chart's computed fields")
		}
		answer.Computed = described
	}
	WriteResolvedTimeRange(w, timeRange)
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(answer)
}

// fieldTypes are the types of `fields` by alias, in their order, as `describe` (a DESCRIBE of the fields selected
// together) answers them, matched by position (a field without alias is named as ClickHouse formats its
// expression): one DESCRIBE of all, else, as one field can make the query of all fail (an aggregate beside a
// plain expression without the chart's GROUP BY), one of each, a field whose own fails left out and its error
// returned.
func fieldTypes(fields []sql.SqlField, describe func([]sql.SqlField) ([]clickhouse.ResultColumn, error)) ([]clickhouse.ResultColumn, error) {
	typed := func(fields []sql.SqlField) ([]clickhouse.ResultColumn, error) {
		described, err := describe(fields)
		if err != nil {
			return nil, fmt.Errorf("clickhouse describe: %w", err)
		}
		if len(described) != len(fields) {
			return nil, fmt.Errorf("clickhouse described %d columns for %d fields", len(described), len(fields))
		}
		answer := make([]clickhouse.ResultColumn, len(fields))
		for i, field := range fields {
			answer[i] = clickhouse.ResultColumn{Name: field.Alias(), Type: described[i].Type}
		}
		return answer, nil
	}
	answer, err := typed(fields)
	if err == nil {
		return answer, nil
	}
	if len(fields) == 1 {
		return []clickhouse.ResultColumn{}, fmt.Errorf("%s: %w", fields[0].Alias(), err)
	}
	answer, errs := []clickhouse.ResultColumn{}, []error(nil)
	for _, field := range fields {
		one, err := typed([]sql.SqlField{field})
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", field.Alias(), err))
			continue
		}
		answer = append(answer, one...)
	}
	return answer, errors.Join(errs...)
}
