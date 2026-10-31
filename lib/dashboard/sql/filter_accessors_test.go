// Tests for what pills need of a query and its fields: TableOf, IsCategory, Condition and Quote.
package sql

import "testing"

func TestTableOf_IsABuilderQuerysFromOrASqlFilesTable(t *testing.T) {
	tests := map[string]struct {
		q     SqlQueryable
		table string
		ok    bool
	}{
		"builder":                 {New(From("http_logs"), OnDatabase("logs")), "http_logs", true},
		"builder, qualified":      {New(From("monitoring.full_logs")), "monitoring.full_logs", true},
		"builder, a subquery":     {New(From("(SELECT 1)")), "(SELECT 1)", false},
		"builder without From":    {New(), "", false},
		"file with Table":         {FromFile("src/shop/by_host.sql", Table("default.http_logs")), "default.http_logs", true},
		"file with Table by With": {FromFile("src/shop/by_host.sql").With(Table("http_logs"), AutoBucketPlaceholder()), "http_logs", true},
		"file without Table":      {FromFile("src/shop/by_host.sql"), "", false},
		"string with Table":       {FromString("SELECT 1 WHERE {{DASHICA_FILTERS}}").With(Table("http_logs")), "http_logs", true},
		"builder ignores Table":   {New(From("http_logs"), Table("other")), "http_logs", true},
		"file, Table is no table": {FromFile("x.sql", Table("http_logs; DROP TABLE x")), "http_logs; DROP TABLE x", false},
	}
	for name, tt := range tests {
		table, ok := TableOf(tt.q)
		if table != tt.table || ok != tt.ok {
			t.Errorf("%s: %q %v, want %q %v", name, table, ok, tt.table, tt.ok)
		}
	}
}

func TestTableOf_ASqlFileKeepsItsTableThroughWithAndJSON(t *testing.T) {
	f := FromFile("src/shop/by_host.sql", Table("http_logs")).With(Where("1=1"))
	b, err := MarshalQueryable(f)
	if err != nil {
		t.Fatal(err)
	}
	back, err := UnmarshalQueryable(b)
	if err != nil {
		t.Fatal(err)
	}
	if table, ok := TableOf(back); table != "http_logs" || !ok {
		t.Errorf("after JSON %s: %q %v", b, table, ok)
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

func TestCondition_ComparesTheDefinitionWithTheQuotedValue(t *testing.T) {
	host := JsonExtractString("attrs", "host")
	if got, ok := Condition(host, "shop", false); !ok || got != "(JSONExtractString(attrs, 'host')) = 'shop'" {
		t.Errorf("eq: %q %v", got, ok)
	}
	if got, _ := Condition(Enum("level"), "it's", true); got != `(level::String) != 'it\'s'` {
		t.Errorf("ne: %q", got)
	}
}

func TestCondition_AFieldWithFilterAsWritesItsOwn(t *testing.T) {
	customer := Field("replace(customer_project, 'customer-', '')").WithAlias("customer").
		FilterAs(func(value string) string { return "customer_project = " + Quote("customer-"+value) })
	if got, _ := Condition(customer, "acme", false); got != "customer_project = 'customer-acme'" {
		t.Errorf("eq: %q", got)
	}
	if got, _ := Condition(customer, "acme", true); got != "NOT (customer_project = 'customer-acme')" {
		t.Errorf("ne: %q", got)
	}
	// FilterAs keeps the alias, WithAlias keeps FilterAs
	if renamed, _ := Condition(customer.WithAlias("c"), "x", false); customer.Alias() != "customer" || renamed != "customer_project = 'customer-x'" {
		t.Errorf("alias %q, renamed %q", customer.Alias(), renamed)
	}
}

func TestCondition_NoneForACountOrATimeBucket(t *testing.T) {
	for _, f := range []SqlField{Count(), Timestamp15Min(), AutoBucket("timestamp").FilterAs(func(string) string { return "1" }), nil} {
		if got, ok := Condition(f, "1", false); ok || got != "" {
			t.Errorf("%v: %q", f, got)
		}
	}
}

func TestQuote_EscapesBackslashAndQuote(t *testing.T) {
	tests := map[string]string{
		"acme":               `'acme'`,
		"it's":               `'it\'s'`,
		`a\b`:                `'a\\b'`,
		`\'; DROP TABLE x--`: `'\\\'; DROP TABLE x--'`,
		"":                   `''`,
		"line\nbreak":        "'line\nbreak'",
	}
	for value, want := range tests {
		if got := Quote(value); got != want {
			t.Errorf("Quote(%q) = %s, want %s", value, got, want)
		}
	}
}
