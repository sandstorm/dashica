// Tests for Ungrouped.
package sql

import (
	"strings"
	"testing"
)

// body is the SQL of `q` below its two comment lines.
func body(q SqlQueryable) string {
	lines := strings.Split(q.Build(), "\n")
	return strings.Join(lines[2:], "\n")
}

func TestUngrouped_ACaddyChartIsItsTableWhereAndWindowNewestFirst(t *testing.T) {
	project := Field("replace(customer_project, concat('sandstorm', '.'), '')").WithAlias("customer_project")
	chart := New(From("caddy_logs"), Where("customer_tenant = 'sandstorm'"), OnDatabase("logs")).With(
		PrependSelect(AutoBucketAs("timestamp", "timestamp")),
		Select(project),
		Select(Count().WithAlias("requests")),
		GroupBy(AutoBucketAs("timestamp", "timestamp")),
		GroupBy(project),
		OrderBy(AutoBucketAs("timestamp", "timestamp")),
		WithFill("toIntervalHour(1)"),
		Limit(500),
		// a page filter on the fill, as filter.Apply adds it: on its definition
		Where("(replace(customer_project, concat('sandstorm', '.'), '')) = {__f0:String}"),
	)

	rows, ok := Ungrouped(chart, 100_000)

	if !ok {
		t.Fatal("a builder query has rows without grouping")
	}
	want := "SELECT\n" +
		"    *\n" +
		"FROM\n" +
		"    caddy_logs\n" +
		"WHERE\n" +
		"    (customer_tenant = 'sandstorm')\n" +
		"    AND ((replace(customer_project, concat('sandstorm', '.'), '')) = {__f0:String})\n" +
		"ORDER BY\n" +
		"    timestamp DESC\n" +
		"LIMIT 100000;"
	if got := body(rows); got != want {
		t.Errorf("got:\n%s\nwant:\n%s", got, want)
	}
	if rows.Database() != "logs" || rows.ShouldSkipFilters() {
		t.Errorf("database %q, skip filters %v", rows.Database(), rows.ShouldSkipFilters())
	}
	if !strings.Contains(chart.Build(), "GROUP BY") {
		t.Errorf("the chart's query changed:\n%s", chart.Build())
	}
}

func TestUngrouped_AQueryWithoutTheTimeRangeKeepsClickHousesOrder(t *testing.T) {
	rows, _ := Ungrouped(New(From("system.parts"), SkipFilters(), Select(Field("table")), GroupBy(Field("table"))), 10)

	if got := body(rows); got != "SELECT\n    *\nFROM\n    system.parts\nLIMIT 10;" || !rows.ShouldSkipFilters() {
		t.Errorf("skip filters %v:\n%s", rows.ShouldSkipFilters(), got)
	}
}

func TestUngrouped_ASqlFileHasNone(t *testing.T) {
	for _, q := range []SqlQueryable{FromFile("by_host.sql"), FromString("SELECT 1 WHERE {{DASHICA_FILTERS}}")} {
		if _, ok := Ungrouped(q, 10); ok {
			t.Errorf("%T has rows without grouping", q)
		}
	}
}
