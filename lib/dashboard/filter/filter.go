// Package filter is how a chart interprets the page's structured filters (`?f=host:eq:a`) when it runs: Apply, the
// default every chart without its own ApplyFilters gets, and Diagnostics, what the chart tells the outside about it.
// See docs/2026-10-28-workbench.md §3.8.
package filter

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// Filter is one structured filter, `f=host:eq:a`: the rows whose field ID equals (`eq`) or differs from (`ne`) Value.
type Filter struct {
	// ID is the alias of the column the viewer clicked ("host"); each chart decides what it means.
	ID string
	// Op is `eq` or `ne`.
	Op string
	// Value is compared as a ClickHouse String parameter, which ClickHouse converts to the column's type.
	Value string
}

// Diagnostics is what a chart tells the outside about one answer, sent with its data (X-Dashica-Diagnostics).
type Diagnostics struct {
	// Ignored are the filter ids the chart does not interpret, each once, in the order of the URL.
	Ignored []string `json:"ignored,omitempty"`
	// Skipped is non-empty when the chart did not run, and says why.
	Skipped string `json:"skipped,omitempty"`
}

// Columns are the names of the columns of `table` on the ClickHouse server `server` ("" for "default") that a filter
// value compares with, as DESCRIBE TABLE gives them.
type Columns func(ctx context.Context, server, table string) ([]string, error)

// Param is the name of the ClickHouse parameter that holds the value of the request's `i`-th filter (`__f0`); the
// query handler binds every filter's value by it.
func Param(i int) string {
	return fmt.Sprintf("__f%d", i)
}

// Condition is the request's `i`-th filter `f` on `expression`: `(status) = {__f0:String}`, `!=` for `ne`.
func Condition(i int, f Filter, expression string) string {
	op := "="
	if f.Op == "ne" {
		op = "!="
	}
	return fmt.Sprintf("(%s) %s {%s:String}", expression, op, Param(i))
}

// Apply is `q` with the filters it interprets added as one more Where, and the Diagnostics naming the others. A
// filter id is interpreted when it is the alias of one of `fields` (the chart's own fields) that holds categories
// (sql.IsCategory): a builder query compares the field's definition (`JSONExtractString(attrs, 'host')`), a SQL file
// its output column by name. Else, for a builder query, when it is a column of its base table (`columns`, asked only
// then) that no select of the query aliases with another expression. A query that skips filters interprets none. The
// error is the one of `columns`.
func Apply(ctx context.Context, q sql.SqlQueryable, fields []sql.SqlField, filters []Filter, columns Columns) (sql.SqlQueryable, Diagnostics, error) {
	var d Diagnostics
	ignore := func(id string) {
		if !slices.Contains(d.Ignored, id) {
			d.Ignored = append(d.Ignored, id)
		}
	}
	if q.ShouldSkipFilters() {
		for _, f := range filters {
			ignore(f.ID)
		}
		return q, d, nil
	}
	table, builder := baseTable(q)
	var tableColumns []string
	asked := false
	var conditions []string
	for i, f := range filters {
		expression, ok := ownField(fields, f.ID, builder)
		if !ok && builder {
			if !asked {
				var err error
				if tableColumns, err = columns(ctx, q.Database(), table); err != nil {
					return nil, Diagnostics{}, fmt.Errorf("columns of %s: %w", table, err)
				}
				asked = true
			}
			if slices.Contains(tableColumns, f.ID) && !shadowed(q, f.ID) {
				expression, ok = identifier(f.ID), true
			}
		}
		if !ok {
			ignore(f.ID)
			continue
		}
		conditions = append(conditions, Condition(i, f, expression))
	}
	if len(conditions) > 0 {
		q = q.With(sql.Where(strings.Join(conditions, " AND ")))
	}
	return q, d, nil
}

// baseTable is the table a builder query reads; false for a SQL file and for a builder query without From.
func baseTable(q sql.SqlQueryable) (string, bool) {
	table, _, ok := sql.BaseTable(q)
	return table, ok && table != ""
}

// ownField is what the chart's field aliased `id` compares: its definition in a builder query, its output column in
// a SQL file; false when no category field has that alias.
func ownField(fields []sql.SqlField, id string, builder bool) (string, bool) {
	for _, field := range fields {
		if field == nil || field.Alias() != id || !sql.IsCategory(field) {
			continue
		}
		if builder {
			return field.Definition(), true
		}
		return identifier(id), true
	}
	return "", false
}

// shadowed is whether a select of the builder query `q` aliases `id` with another expression: ClickHouse resolves that
// alias in WHERE, so the column `id` would compare the select (`sum(bytes) AS bytes`, `toStartOfHour(ts) AS ts`).
func shadowed(q sql.SqlQueryable, id string) bool {
	b, ok := q.(*sql.SqlQuery)
	return ok && slices.ContainsFunc(b.SelectFields(), func(s sql.SqlField) bool {
		return s.Alias() == id && s.Definition() != id
	})
}

var plainIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// identifier is the column `name` as ClickHouse SQL: `host` as it is, `my-host` in backquotes.
func identifier(name string) string {
	if plainIdentifier.MatchString(name) {
		return name
	}
	return "`" + strings.NewReplacer(`\`, `\\`, "`", "\\`").Replace(name) + "`"
}
