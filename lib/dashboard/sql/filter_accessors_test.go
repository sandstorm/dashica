// Tests for BaseTable and IsCategory.
package sql

import "testing"

func TestBaseTable_IsTheFromOfABuilderQueryOnly(t *testing.T) {
	if table, database, ok := BaseTable(New(From("http_logs"), OnDatabase("logs"))); !ok || table != "http_logs" || database != "logs" {
		t.Errorf("builder: %q %q %v", table, database, ok)
	}
	for _, q := range []SqlQueryable{FromFile("src/shop/by_host.sql"), FromString("SELECT 1")} {
		if _, _, ok := BaseTable(q); ok {
			t.Errorf("%T has no base table", q)
		}
	}
}

func TestIsCategory_EveryFieldButCountsAndTimeBuckets(t *testing.T) {
	for _, f := range []SqlField{Field("status"), Enum("level"), JsonExtractString("attrs", "host"), NewFieldAlias("host"), Count()} {
		want := f.Alias() != "cnt"
		if got := IsCategory(f); got != want {
			t.Errorf("%s: got %v", f.Definition(), got)
		}
	}
	for _, f := range []SqlField{Timestamp15Min(), TimestampField("toStartOfHour(ts)", "time", 3600_000), AutoBucket("timestamp"), AutoBucket("timestamp").WithAlias("t")} {
		if IsCategory(f) {
			t.Errorf("%s is a time bucket", f.Definition())
		}
	}
}
