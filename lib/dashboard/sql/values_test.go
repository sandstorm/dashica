// Tests for Values: the distinct values of a field on a builder query's base and on a SQL file's result.
package sql

import (
	"strings"
	"testing"
)

func TestValues_OfABuilderQueryIsItsBaseGroupedByTheField(t *testing.T) {
	chart := New(From("http_logs"), Where("path != '/'"), Select(Field("status")), Select(Count()), GroupBy(Field("status")), OrderBy(Count()), Limit(5), OnDatabase("logs"))

	got := Values(chart, JsonExtractString("attrs", "host"), 100).With(Where("time_clause")).Build()

	want := `SELECT
    toString(JSONExtractString(attrs, 'host')) AS __value
FROM
    http_logs
WHERE
    (path != '/')
    AND (positionCaseInsensitive(toString(JSONExtractString(attrs, 'host')), {__search:String}) > 0)
    AND (time_clause)
GROUP BY
    __value
ORDER BY
    __value
LIMIT 100;`
	if !strings.HasSuffix(got, want) {
		t.Errorf("got:\n%s", got)
	}
	if db := Values(chart, Field("status"), 100).Database(); db != "logs" {
		t.Errorf("database %q", db)
	}
	if chart.Build() != New(From("http_logs"), Where("path != '/'"), Select(Field("status")), Select(Count()), GroupBy(Field("status")), OrderBy(Count()), Limit(5), OnDatabase("logs")).Build() {
		t.Errorf("the chart's query changed")
	}
}

func TestValues_OfASqlStringIsItsResultInASubquery(t *testing.T) {
	file := FromString("SELECT host, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY host -- by host\n;\n").With(Table("http_logs"), OnDatabase("logs"))

	got, err := BuildWithFS(Values(file, NewFieldAlias("host"), 100).With(Where("time_clause")), nil)

	want := `SELECT toString(host) AS __value
FROM (
SELECT host, count() AS cnt FROM http_logs WHERE (time_clause) GROUP BY host -- by host

)
WHERE positionCaseInsensitive(__value, {__search:String}) > 0
GROUP BY __value
ORDER BY __value
LIMIT 100`
	if err != nil || got != want {
		t.Errorf("%v, got:\n%s", err, got)
	}
	if v := Values(file, NewFieldAlias("host"), 100); v.Database() != "logs" || v.ShouldSkipFilters() {
		t.Errorf("database %q, skips filters %v", v.Database(), v.ShouldSkipFilters())
	}
}
