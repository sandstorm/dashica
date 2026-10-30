// Tests for Apply and Condition.
package filter

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// fixedColumns is a column source with `http_logs` on server "default" ("") and `caddy_logs` on "logs"; it counts
// what it is asked.
func fixedColumns(asked *int) Columns {
	return func(_ context.Context, server, table string) ([]string, error) {
		*asked++
		switch server + "/" + table {
		case "/http_logs":
			return []string{"timestamp", "status", "path", "my-host", "bytes"}, nil
		case "logs/caddy_logs":
			return []string{"timestamp", "upstream"}, nil
		}
		return nil, nil
	}
}

func filters(fs ...string) []Filter {
	var out []Filter
	for _, f := range fs {
		parts := strings.SplitN(f, ":", 3)
		out = append(out, Filter{ID: parts[0], Op: parts[1], Value: parts[2]})
	}
	return out
}

func apply(t *testing.T, q sql.SqlQueryable, fields []sql.SqlField, fs []Filter) (string, Diagnostics, int) {
	t.Helper()
	asked := 0
	got, d, err := Apply(context.Background(), q, fields, fs, fixedColumns(&asked))
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	return got.Build(), d, asked
}

func TestApply_AnOwnFieldComparesItsDefinition(t *testing.T) {
	q := sql.New(sql.From("http_logs"))
	fields := []sql.SqlField{sql.JsonExtractString("attrs", "host"), sql.Count()}

	built, d, asked := apply(t, q, fields, filters("host:ne:a:b", "host:eq:shop"))

	if want := "((JSONExtractString(attrs, 'host')) != {__f0:String} AND (JSONExtractString(attrs, 'host')) = {__f1:String})"; !strings.Contains(built, want) {
		t.Errorf("query lacks %s:\n%s", want, built)
	}
	if d.Ignored != nil || asked != 0 {
		t.Errorf("diagnostics %+v, asked DESCRIBE %d times", d, asked)
	}
}

func TestApply_ABaseTableColumnComparesTheColumn(t *testing.T) {
	built, d, _ := apply(t, sql.New(sql.From("http_logs")), nil, filters("status:eq:500", "my-host:eq:a"))

	if want := "((status) = {__f0:String} AND (`my-host`) = {__f1:String})"; !strings.Contains(built, want) {
		t.Errorf("query lacks %s:\n%s", want, built)
	}
	if d.Ignored != nil {
		t.Errorf("ignored %v", d.Ignored)
	}
}

func TestApply_AColumnASelectAliasesWithAnotherExpressionIsIgnored(t *testing.T) {
	// ClickHouse would compare the select: sum(bytes) in WHERE fails, the hour bucket matches other rows
	q := sql.New(sql.From("http_logs"),
		sql.Select(sql.Field("sum(bytes)").WithAlias("bytes")),
		sql.Select(sql.Field("toStartOfHour(timestamp)").WithAlias("timestamp")),
		sql.Select(sql.Field("status")),
	)

	built, d, _ := apply(t, q, nil, filters("bytes:eq:100", "timestamp:eq:1761730000", "status:eq:500"))

	if want := "((status) = {__f2:String})"; !strings.Contains(built, want) {
		t.Errorf("query lacks %s:\n%s", want, built)
	}
	if want := []string{"bytes", "timestamp"}; !reflect.DeepEqual(d.Ignored, want) {
		t.Errorf("ignored %v, want %v", d.Ignored, want)
	}
}

func TestApply_TheOthersAreIgnoredOnceInURLOrderAndKeepTheirIndex(t *testing.T) {
	q := sql.New(sql.From("caddy_logs"), sql.OnDatabase("logs"))

	built, d, asked := apply(t, q, nil, filters("nope:eq:1", "status:eq:500", "upstream:eq:a", "nope:ne:2"))

	if want := "((upstream) = {__f2:String})"; !strings.Contains(built, want) {
		t.Errorf("query lacks %s:\n%s", want, built)
	}
	if want := []string{"nope", "status"}; !reflect.DeepEqual(d.Ignored, want) {
		t.Errorf("ignored %v, want %v", d.Ignored, want)
	}
	if asked != 1 {
		t.Errorf("asked DESCRIBE %d times, want once", asked)
	}
}

func TestApply_MeasuresAndTimeBucketsAreNoFilters(t *testing.T) {
	// on a table without such columns, so only the fields could interpret them
	q := sql.New(sql.From("other"))
	fields := []sql.SqlField{sql.Count(), sql.Timestamp15Min(), sql.AutoBucketAs("ts", "bucket")}

	_, d, _ := apply(t, q, fields, filters("cnt:eq:1", "time:eq:1", "bucket:eq:1"))

	if want := []string{"cnt", "time", "bucket"}; !reflect.DeepEqual(d.Ignored, want) {
		t.Errorf("ignored %v, want %v", d.Ignored, want)
	}
}

func TestApply_ASqlFileInterpretsItsOwnOutputColumnsOnly(t *testing.T) {
	q := sql.FromString("SELECT host, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY host")
	fields := []sql.SqlField{sql.NewFieldAlias("host"), sql.Count()}

	built, d, asked := apply(t, q, fields, filters("host:eq:shop", "status:eq:500"))

	if want := "WHERE ((host) = {__f0:String}) GROUP BY"; !strings.Contains(built, want) {
		t.Errorf("query lacks %s:\n%s", want, built)
	}
	if !reflect.DeepEqual(d.Ignored, []string{"status"}) || asked != 0 {
		t.Errorf("ignored %v, asked DESCRIBE %d times", d.Ignored, asked)
	}
}

func TestApply_AQueryThatSkipsFiltersInterpretsNone(t *testing.T) {
	q := sql.New(sql.From("http_logs"), sql.SkipFilters())

	built, d, asked := apply(t, q, []sql.SqlField{sql.Field("status")}, filters("status:eq:500", "path:eq:/"))

	if strings.Contains(built, "__f") || !reflect.DeepEqual(d.Ignored, []string{"status", "path"}) || asked != 0 {
		t.Errorf("want all ignored: %+v, asked %d\n%s", d, asked, built)
	}
}

func TestApply_WithoutFiltersAsksNothing(t *testing.T) {
	q := sql.New(sql.From("http_logs"))
	built, d, asked := apply(t, q, nil, nil)
	if built != q.Build() || d.Ignored != nil || asked != 0 {
		t.Errorf("want q unchanged, got %+v, asked %d", d, asked)
	}
}

func TestApply_AFailingColumnSourceFails(t *testing.T) {
	failing := func(context.Context, string, string) ([]string, error) { return nil, errors.New("connection refused") }
	_, _, err := Apply(context.Background(), sql.New(sql.From("http_logs")), nil, filters("status:eq:500"), failing)
	if err == nil || !strings.Contains(err.Error(), "connection refused") {
		t.Errorf("err = %v", err)
	}
}

func TestApply_LeavesTheChartsQueryAsItIs(t *testing.T) {
	q := sql.New(sql.From("http_logs"), sql.Where("a"), sql.Where("b"))
	before := q.Build()
	_, _, _ = apply(t, q, nil, filters("status:eq:500"))
	if q.Build() != before {
		t.Errorf("the chart's query changed:\n%s", q.Build())
	}
}
