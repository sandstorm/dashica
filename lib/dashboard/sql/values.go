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

// ValuesTypeColumn is the column of Values whose type, as ClickHouse reports it in the answer's metadata, is the type
// of the field's expression (`any(<definition>)`: "DateTime64(3)", "LowCardinality(String)"), also for no rows.
const ValuesTypeColumn = "__type"

// Values is the query of the distinct values `field` shows on `q`, as text, sorted, at most `limit`, those containing
// the parameter ValuesSearchParameter, beside one of them as it is (ValuesTypeColumn, for the field's type;
// docs/2026-10-28-workbench.md §3.14 D15, §3.15 D25, the filter bar's "add filter"): of a builder query its base, the
// From and its Where without its own SELECT, GROUP BY, ORDER BY and LIMIT (`SELECT toString(host) AS __value,
// any(host) AS __type FROM http_logs WHERE … GROUP BY __value ORDER BY __value LIMIT 100`); of a SQL file or
// string, whose field is a column of its result, its result (`SELECT … FROM (<file>) …`). The handler adds the time
// range and the filters with With, as to the chart's query.
func Values(q SqlQueryable, field SqlField, limit int) SqlQueryable {
	if b, ok := q.(*SqlQuery); ok {
		value := Field("toString(" + field.Definition() + ")").WithAlias(valuesColumn)
		base := *b
		base.selectF = []SqlField{value, Field("any(" + field.Definition() + ")").WithAlias(ValuesTypeColumn)}
		base.groupBy = []SqlField{value}
		base.orderBy = []SqlField{value}
		base.fillStep = ""
		base.limit = limit
		base.where = append(slices.Clip(b.where), searched(value.Definition()))
		return &base
	}
	return &valuesOf{result: q, definition: field.Definition(), limit: limit}
}

// ValueType is the query of no rows whose ValuesTypeColumn has the type of `field` on `q`, as Values' has it, for a
// field whose values are not asked (a time, docs/2026-10-28-workbench.md §3.15 D25): of a builder query its base
// with `WHERE 0`, which ClickHouse answers without reading the table (`SELECT timestamp AS __type FROM http_logs
// WHERE (0) AND …`); of a SQL file or string its result in a subquery, `WHERE 0` around it (whether ClickHouse runs
// the subquery then is not checked; it costs at most what the chart's own query does).
func ValueType(q SqlQueryable, field SqlField) SqlQueryable {
	if b, ok := q.(*SqlQuery); ok {
		base := *b
		base.selectF = []SqlField{Field(field.Definition()).WithAlias(ValuesTypeColumn)}
		base.groupBy = nil
		base.orderBy = nil
		base.fillStep = ""
		base.limit = 0
		base.where = append(slices.Clip(b.where), "0")
		return &base
	}
	return &valuesOf{result: q, definition: field.Definition(), typeOnly: true}
}

// searched is the condition that `expression` contains the search (ValuesSearchParameter), ignoring case.
func searched(expression string) string {
	return "positionCaseInsensitive(" + expression + ", {" + ValuesSearchParameter + ":String}) > 0"
}

// valuesOf is Values of a SQL file or string: the distinct values of `definition` over its `result`; with
// `typeOnly` ValueType's: no rows, only the type.
type valuesOf struct {
	result     SqlQueryable
	definition string
	limit      int
	typeOnly   bool
}

// Build is the result's SQL in a subquery, one trailing `;` trimmed, on lines of their own so that a trailing
// `-- comment` ends before the `)`.
func (v *valuesOf) Build() string {
	return v.around(v.result.Build())
}

func (v *valuesOf) buildWithFS(fileSystem fs.ReadFileFS) (string, error) {
	inner, err := BuildWithFS(v.result, fileSystem)
	if err != nil {
		return "", err
	}
	return v.around(inner), nil
}

func (v *valuesOf) around(inner string) string {
	inner = strings.TrimSuffix(strings.TrimSpace(inner), ";")
	if v.typeOnly {
		return "SELECT " + v.definition + " AS " + ValuesTypeColumn + "\nFROM (\n" + inner + "\n)\nWHERE 0"
	}
	return "SELECT toString(" + v.definition + ") AS " + valuesColumn + ", any(" + v.definition + ") AS " + ValuesTypeColumn +
		"\nFROM (\n" + inner + "\n)\n" +
		"WHERE " + searched(valuesColumn) + "\n" +
		"GROUP BY " + valuesColumn + "\nORDER BY " + valuesColumn + "\nLIMIT " + strconv.Itoa(v.limit)
}

// With applies `opts` to the result (its Where goes to its {{DASHICA_FILTERS}}).
func (v *valuesOf) With(opts ...SqlBuilderOption) SqlQueryable {
	return &valuesOf{result: v.result.With(opts...), definition: v.definition, limit: v.limit, typeOnly: v.typeOnly}
}

func (v *valuesOf) AdjustBuckets(widthS int64) (SqlQueryable, *int64) {
	result, size := v.result.AdjustBuckets(widthS)
	return &valuesOf{result: result, definition: v.definition, limit: v.limit, typeOnly: v.typeOnly}, size
}

func (v *valuesOf) ShouldSkipFilters() bool {
	return v.result.ShouldSkipFilters()
}

func (v *valuesOf) Database() string {
	return v.result.Database()
}

var _ SqlQueryable = (*valuesOf)(nil)
