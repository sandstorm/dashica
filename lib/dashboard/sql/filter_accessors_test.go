// Tests for what pills need of a query and its fields: TableOf, IsCategory, IsConstantColumn, ColumnOf, ColumnField,
// Condition, Quote and QuoteIdentifier.
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

func TestIsCategory_AConstantIsNone(t *testing.T) {
	for _, f := range []SqlField{Field("'darkred'"), Field("'#D73027'").WithAlias("darkred"), Field("'it\\'s'"), Field("42"), Field(" -0.5 "), Field("1e3")} {
		if IsCategory(f) {
			t.Errorf("%s is a constant", f.Definition())
		}
		if _, ok := Condition(f, OpEq, "darkred"); ok {
			t.Errorf("%s makes no condition", f.Definition())
		}
	}
	for _, f := range []SqlField{Field("concat('shop-', host)"), Field("'a' || host"), Field("status = 500"), Field("x42")} {
		if !IsCategory(f) {
			t.Errorf("%s is no constant", f.Definition())
		}
	}
}

func TestIsConstantColumn_ALiteralSelectedAsTheColumn(t *testing.T) {
	text := `SELECT
    'OK'                                           as status,
    'forestgreen'                                  as color,
    replaceOne(customer_project, 'oekokiste.', '') as instance,
    count(*)                                       as counter,
    42 AS ` + "`answer`" + `,
    CAST('1' AS String) AS one
FROM mv_oekokiste_shop
WHERE {{DASHICA_FILTERS}}
UNION ALL
SELECT 'error' as status, 'darkred' as color, …`
	for column, want := range map[string]bool{"status": true, "color": true, "answer": true, "instance": false, "counter": false, "String": false, "one": false, "col": false} {
		if got := IsConstantColumn(text, column); got != want {
			t.Errorf("%s: got %v", column, got)
		}
	}
}

func TestColumnOf_APlainNameAsItsOwnAlias(t *testing.T) {
	if name, ok := ColumnOf(Field("host_name")); !ok || name != "host_name" {
		t.Errorf("plain: %q %v", name, ok)
	}
	for _, f := range []SqlField{
		Field("customer_project").WithAlias("instance"),
		Field("replaceOne(customer_project, 'oekokiste.', '')"),
		Field("status").FilterAs(func(op Op, value string) string { return op.Compare("status", value) }),
		Field("'darkred'"),
		Enum("level"),
		Count(),
		Timestamp15Min(),
		AutoBucket("timestamp"),
	} {
		if name, ok := ColumnOf(f); ok {
			t.Errorf("%s is no plain column, got %q", f.Definition(), name)
		}
	}
}

func TestColumnField_ComparesTheQuotedColumn(t *testing.T) {
	if got, ok := Condition(ColumnField("event.type"), OpNe, "it's"); !ok || got != "(`event.type`) != 'it\\'s'" {
		t.Errorf("got %q %v", got, ok)
	}
	if got := ColumnField("host").Alias(); got != "host" {
		t.Errorf("alias %q", got)
	}
}

func TestQuoteIdentifier_EscapesBackticksAndBackslashes(t *testing.T) {
	if got := QuoteIdentifier("a`b\\c"); got != "`a\\`b\\\\c`" {
		t.Errorf("got %s", got)
	}
}

func TestCondition_ComparesTheDefinitionWithTheQuotedValue(t *testing.T) {
	host := JsonExtractString("attrs", "host")
	if got, ok := Condition(host, OpEq, "shop"); !ok || got != "(JSONExtractString(attrs, 'host')) = 'shop'" {
		t.Errorf("eq: %q %v", got, ok)
	}
	if got, _ := Condition(Enum("level"), OpNe, "it's"); got != `(level::String) != 'it\'s'` {
		t.Errorf("ne: %q", got)
	}
	if got, _ := Condition(Field("timestamp"), OpGe, "2026-10-31T10:00:00.000Z"); got != "(timestamp) >= '2026-10-31T10:00:00.000Z'" {
		t.Errorf("ge: %q", got)
	}
}

func TestCondition_AFieldWithFilterAsWritesItsOwn(t *testing.T) {
	customer := Field("replace(customer_project, 'customer-', '')").WithAlias("customer").
		FilterAs(func(op Op, value string) string { return op.Compare("customer_project", "customer-"+value) })
	if got, _ := Condition(customer, OpEq, "acme"); got != "customer_project = 'customer-acme'" {
		t.Errorf("eq: %q", got)
	}
	if got, _ := Condition(customer, OpNe, "acme"); got != "customer_project != 'customer-acme'" {
		t.Errorf("ne: %q", got)
	}
	// FilterAs keeps the alias, WithAlias keeps FilterAs
	if renamed, _ := Condition(customer.WithAlias("c"), OpEq, "x"); customer.Alias() != "customer" || renamed != "customer_project = 'customer-x'" {
		t.Errorf("alias %q, renamed %q", customer.Alias(), renamed)
	}
}

func TestCondition_NoneForACountOrATimeBucket(t *testing.T) {
	for _, f := range []SqlField{Count(), Timestamp15Min(), AutoBucket("timestamp").FilterAs(func(Op, string) string { return "1" }), nil} {
		if got, ok := Condition(f, OpGe, "1"); ok || got != "" {
			t.Errorf("%v: %q", f, got)
		}
	}
}

func TestOp_SignsAndComparisons(t *testing.T) {
	tests := []struct {
		op         Op
		sign, cond string
	}{
		{OpEq, "=", "x = 'v'"},
		{OpNe, "≠", "x != 'v'"},
		{OpLt, "<", "x < 'v'"},
		{OpLe, "≤", "x <= 'v'"},
		{OpGt, ">", "x > 'v'"},
		{OpGe, "≥", "x >= 'v'"},
	}
	for _, tt := range tests {
		if !tt.op.Valid() || tt.op.Sign() != tt.sign || tt.op.Compare("x", "v") != tt.cond {
			t.Errorf("%s: valid %v, sign %q, compare %q", tt.op, tt.op.Valid(), tt.op.Sign(), tt.op.Compare("x", "v"))
		}
	}
	for _, op := range []Op{"", "like", "EQ"} {
		if op.Valid() {
			t.Errorf("%q is valid", op)
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
