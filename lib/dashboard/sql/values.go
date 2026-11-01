package sql

import (
	"io/fs"
	"slices"
	"strconv"
	"strings"
)

// ValuesSearchParameter is the ClickHouse parameter of Values' search (`{__search:String}`): the text a value
// contains, ignoring case; "" for every value.
const ValuesSearchParameter = "__search"

// valuesColumn is the column Values answers its values in.
const valuesColumn = "__value"

// Values is the query of the distinct values `field` shows on `q`, as text, sorted, at most `limit`, those containing
// the parameter ValuesSearchParameter (docs/2026-10-28-workbench.md §3.14 D15, the filter bar's "add filter"): of a
// builder query its base, the From and its Where without its own SELECT, GROUP BY, ORDER BY and LIMIT (`SELECT
// toString(host) AS __value FROM http_logs WHERE … GROUP BY __value ORDER BY __value LIMIT 100`); of a SQL file or
// string, whose field is a column of its result, its result (`SELECT … FROM (<file>) …`). The handler adds the time
// range and the filters with With, as to the chart's query.
func Values(q SqlQueryable, field SqlField, limit int) SqlQueryable {
	if b, ok := q.(*SqlQuery); ok {
		value := Field("toString(" + field.Definition() + ")").WithAlias(valuesColumn)
		base := *b
		base.selectF = []SqlField{value}
		base.groupBy = []SqlField{value}
		base.orderBy = []SqlField{value}
		base.fillStep = ""
		base.limit = limit
		base.where = append(slices.Clip(b.where), searched(value.Definition()))
		return &base
	}
	definition := field.Definition()
	return &around{result: q, wrap: func(inner string) string {
		return "SELECT toString(" + definition + ") AS " + valuesColumn +
			"\nFROM (\n" + inner + "\n)\n" +
			"WHERE " + searched(valuesColumn) + "\n" +
			"GROUP BY " + valuesColumn + "\nORDER BY " + valuesColumn + "\nLIMIT " + strconv.Itoa(limit)
	}}
}

// FieldTypes is the query of no rows with one column per field of `fields` on `q`, in their order (an alias as
// the builder writes it: a field without one is named as ClickHouse formats its expression), whose types
// ClickHouse's `DESCRIBE (<query>)` reports without running it (docs/2026-10-28-workbench.md §3.15 D39, a chart's
// `/fields`): of a builder query its base, its Where and `WHERE 0` (`SELECT lower(host_name) AS host FROM http_logs
// WHERE (path != '/') AND (0) AND …`); of a SQL file or string, whose fields are columns of its result, its result in
// a subquery, `WHERE 0` around it. The handler adds the time range with With, as to the chart's query, so that the
// placeholders and {{DASHICA_FILTERS}} of a SQL file are filled in.
func FieldTypes(q SqlQueryable, fields []SqlField) SqlQueryable {
	columns := make([]SqlField, len(fields))
	for i, field := range fields {
		columns[i] = Field(field.Definition()).WithAlias(field.Alias())
	}
	if b, ok := q.(*SqlQuery); ok {
		base := *b
		base.selectF = columns
		base.groupBy = nil
		base.orderBy = nil
		base.fillStep = ""
		base.limit = 0
		base.where = append(slices.Clip(b.where), "0")
		return &base
	}
	return &around{result: q, wrap: func(inner string) string {
		selected := make([]string, len(columns))
		for i, column := range columns {
			selected[i] = column.Definition()
			if column.Alias() != column.Definition() {
				selected[i] += " AS " + column.Alias()
			}
		}
		return "SELECT " + strings.Join(selected, ", ") + "\nFROM (\n" + inner + "\n)\nWHERE 0"
	}}
}

// searched is the condition that `expression` contains the search (ValuesSearchParameter), ignoring case.
func searched(expression string) string {
	return "positionCaseInsensitive(" + expression + ", {" + ValuesSearchParameter + ":String}) > 0"
}

// around is Values or FieldTypes of a SQL file or string: `wrap` puts a query around its `result`.
type around struct {
	result SqlQueryable
	wrap   func(inner string) string
}

// Build is the result's SQL in a subquery, one trailing `;` trimmed, on lines of their own so that a trailing
// `-- comment` ends before the `)`.
func (a *around) Build() string {
	return a.wrap(trimmed(a.result.Build()))
}

func (a *around) buildWithFS(fileSystem fs.ReadFileFS) (string, error) {
	inner, err := BuildWithFS(a.result, fileSystem)
	if err != nil {
		return "", err
	}
	return a.wrap(trimmed(inner)), nil
}

// trimmed is `inner` without its spaces around and one trailing `;`.
func trimmed(inner string) string {
	return strings.TrimSuffix(strings.TrimSpace(inner), ";")
}

// With applies `opts` to the result (its Where goes to its {{DASHICA_FILTERS}}).
func (a *around) With(opts ...SqlBuilderOption) SqlQueryable {
	return &around{result: a.result.With(opts...), wrap: a.wrap}
}

func (a *around) AdjustBuckets(widthS int64) (SqlQueryable, *int64) {
	result, size := a.result.AdjustBuckets(widthS)
	return &around{result: result, wrap: a.wrap}, size
}

func (a *around) ShouldSkipFilters() bool {
	return a.result.ShouldSkipFilters()
}

func (a *around) Database() string {
	return a.result.Database()
}

var _ SqlQueryable = (*around)(nil)
