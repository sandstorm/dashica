// Tests for FilterService (TableOf, Sign, Open, TableName), New, NewButton and Apply.
package filter

import (
	"encoding/base64"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

var secret = []byte("a test secret of at least thirty-two bytes")

// service is the FilterService of a dashica_config with the filters.secret `filterSecret` and the database "default"
// on the connection default, "monitoring" on logs, none on any other.
func service(filterSecret string) *FilterService {
	return NewFilterService(&config.Config{
		ClickHouse: map[string]config.ClickHouseConfig{"default": {Database: "default"}, "logs": {Database: "monitoring"}},
		Filters:    config.FiltersConfig{Secret: filterSecret},
	})
}

var filters = service(string(secret))

var httpLogs = Table{Connection: "default", Name: "default.http_logs"}

func pill(t *testing.T, table Table, field sql.SqlField, op sql.Op, value string) Pill {
	t.Helper()
	p, err := New(table, field, op, value)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return p
}

func TestTableOf_NamesTheTableWithItsDatabaseOnItsConnection(t *testing.T) {
	tests := map[string]struct {
		q    sql.SqlQueryable
		want Table
		ok   bool
	}{
		"From in the connection's database": {sql.New(sql.From("http_logs")), httpLogs, true},
		"From with its database":            {sql.New(sql.From("default.http_logs")), httpLogs, true},
		"another connection":                {sql.New(sql.From("full_logs"), sql.OnDatabase("logs")), Table{"logs", "monitoring.full_logs"}, true},
		"a SQL file's Table":                {sql.FromFile("x.sql", sql.Table("http_logs")), httpLogs, true},
		"a SQL file without Table":          {sql.FromFile("x.sql"), Table{}, false},
		"a subquery":                        {sql.New(sql.From("(SELECT 1)")), Table{}, false},
		"a query that skips filters":        {sql.New(sql.From("http_logs"), sql.SkipFilters()), Table{}, false},
	}
	for name, tt := range tests {
		got, ok := filters.TableOf(tt.q)
		if got != tt.want || ok != tt.ok {
			t.Errorf("%s: %+v %v, want %+v %v", name, got, ok, tt.want, tt.ok)
		}
	}
}

func TestNew_WritesTheFieldsConditionAndLabel(t *testing.T) {
	host := pill(t, httpLogs, sql.JsonExtractString("attrs", "host"), "ne", "it's")
	want := Pill{Table: httpLogs, Field: "host", Op: "ne", Condition: `(JSONExtractString(attrs, 'host')) != 'it\'s'`, Label: "host ≠ it's", Value: "it's"}
	if host != want {
		t.Errorf("got %+v", host)
	}
	if _, err := New(httpLogs, sql.Count(), "eq", "1"); !errors.Is(err, ErrCannotFilter) {
		t.Errorf("count: %v", err)
	}
	if _, err := New(httpLogs, sql.Field("status"), "like", "5"); err == nil {
		t.Errorf("op like accepted")
	}
	since, err := New(httpLogs, sql.Field("timestamp"), "ge", "2026-10-31T10:00:00.000Z")
	want = Pill{Table: httpLogs, Field: "timestamp", Op: "ge", Condition: "(timestamp) >= '2026-10-31T10:00:00.000Z'",
		Label: "timestamp ≥ 2026-10-31T10:00:00.000Z", Value: "2026-10-31T10:00:00.000Z"}
	if err != nil || since != want {
		t.Errorf("ge: %+v, %v", since, err)
	}
}

func TestNew_AColumnsPillIsAColumn(t *testing.T) {
	got := pill(t, httpLogs, sql.ColumnField("host"), "eq", "web-1")
	want := Pill{Table: httpLogs, Field: "host", Column: true, Op: "eq", Condition: "(`host`) = 'web-1'", Label: "host = web-1", Value: "web-1"}
	if got != want {
		t.Errorf("got %+v", got)
	}
}

// signed is the key of `p` and its part before the mac, checking the mac is 22 characters of base64url.
func signed(t *testing.T, p Pill) (key, head string) {
	t.Helper()
	key, err := filters.Sign(p)
	if err != nil {
		t.Fatal(err)
	}
	i := strings.LastIndex(key, "~")
	if mac := key[i+1:]; len(mac) != 22 || strings.ContainsAny(mac, "+/=") {
		t.Errorf("mac %q of %q: want 22 characters of base64url", mac, key)
	}
	return key, key[:i]
}

func TestSign_WritesAReadableKey(t *testing.T) {
	customer := sql.Field("replace(customer_project, 'customer-', '')").WithAlias("customer").
		FilterAs(func(op sql.Op, value string) string { return op.Compare("customer_project", "customer-"+value) })
	for want, p := range map[string]Pill{
		"http_logs.host=web-1":  pill(t, httpLogs, sql.ColumnField("host"), "eq", "web-1"),
		"http_logs.status<=500": pill(t, httpLogs, sql.ColumnField("status"), "le", "500"),
		"http_logs.customer!=acme~customer_project != 'customer-acme'": pill(t, httpLogs, customer, "ne", "acme"),
		"system.one.dummy>1":            pill(t, Table{"default", "system.one"}, sql.ColumnField("dummy"), "gt", "1"),
		"logs:full_logs.host>=a":        pill(t, Table{"logs", "monitoring.full_logs"}, sql.ColumnField("host"), "ge", "a"),
		"logs:default.full_logs.host<a": pill(t, Table{"logs", "default.full_logs"}, sql.ColumnField("host"), "lt", "a"),
	} {
		if _, head := signed(t, p); head != want {
			t.Errorf("key %q, want %q", head, want)
		}
	}
}

func TestSignAndOpen_GiveThePillBack(t *testing.T) {
	path := sql.Field("path").WithAlias("a.path=x")
	for name, p := range map[string]Pill{
		"a column":                      pill(t, httpLogs, sql.ColumnField("host"), "eq", "web-1"),
		"an expression":                 pill(t, httpLogs, sql.JsonExtractString("attrs", "host"), "ne", "it's ~ 50%"),
		"a value with separators":       pill(t, httpLogs, sql.ColumnField("host"), "eq", "a~b.c=d!e<f>g@h:i%7E"),
		"a value starting with =":       pill(t, httpLogs, sql.ColumnField("status"), "lt", "=5"),
		"an empty value":                pill(t, httpLogs, sql.ColumnField("host"), "eq", ""),
		"a field with separators":       pill(t, httpLogs, path, "eq", "/"),
		"another connection":            pill(t, Table{"logs", "monitoring.full_logs"}, sql.ColumnField("host"), "ge", "a"),
		"another database":              pill(t, Table{"logs", "default.full_logs"}, sql.ColumnField("host"), "le", "a"),
		"a connection without database": pill(t, Table{"other", "http_logs"}, sql.ColumnField("host"), "gt", "a"),
		"a connection with separators":  pill(t, Table{"a:b.c", "x.y"}, sql.ColumnField("host"), "eq", "a"),
	} {
		key, _ := signed(t, p)
		if got, err := filters.Open(key); err != nil || got != p {
			t.Errorf("%s: Open(%q): %+v, %v, want %+v", name, key, got, err, p)
		}
	}
}

func TestOpen_RefusesAKeyNotSignedByThisSecret(t *testing.T) {
	p := pill(t, httpLogs, sql.ColumnField("status"), "eq", "500")
	key, head := signed(t, p)
	mac := key[len(head)+1:]
	otherSecret, _ := service("another secret of at least thirty-two bytes").Sign(p)
	for name, k := range map[string]string{
		"the value changed":       "http_logs.status=200~" + mac,
		"a condition added":       head + "~1 = 1~" + mac,
		"another op":              "http_logs.status!=500~" + mac,
		"unsigned":                head,
		"another secret":          otherSecret,
		"bad mac":                 head + "~x",
		"empty":                   "",
		"the old filter f":        "status:eq:500",
		"a key before 2026-10-31": "eyJjb25uZWN0aW9uIjoiZGVmYXVsdCJ9.eyJ4IjoxfQ",
	} {
		if _, err := filters.Open(k); err == nil {
			t.Errorf("%s: opened", name)
		}
	}
	if _, err := service("").Open(key); err == nil {
		t.Errorf("opened without a secret")
	}
	if _, err := service("").Sign(p); err == nil {
		t.Errorf("signed without a secret")
	}
}

func TestOpen_RefusesASignedKeyItCannotRead(t *testing.T) {
	for _, head := range []string{"http_logs.host", "host=a", "http_logs.=a", "a~b~c", "@status >= ...", "@status >= 500~1", "http_logs.host=%zz", "a.b.c.host=1"} {
		key := head + "~" + base64.RawURLEncoding.EncodeToString(mac(secret, head))
		if p, err := filters.Open(key); err == nil {
			t.Errorf("%q: opened as %+v", head, p)
		}
	}
}

func TestApply_AddsThePillsOnItsTableAndNamesTheOthers(t *testing.T) {
	q := sql.New(sql.From("http_logs"))
	table, ok := filters.TableOf(q)
	status := pill(t, httpLogs, sql.Field("status"), "eq", "500")
	other := pill(t, Table{"logs", "monitoring.full_logs"}, sql.Field("status"), "eq", "500")
	other.Label = "full_logs status = 500"

	got, d := Apply(q, table, ok, []Pill{status, other, other})

	if !strings.Contains(got.Build(), "((status) = '500')") {
		t.Errorf("query:\n%s", got.Build())
	}
	if !reflect.DeepEqual(d.Ignored, []string{"full_logs status = 500"}) {
		t.Errorf("ignored %v", d.Ignored)
	}
}

func TestApply_PillsOnOneFieldCombine(t *testing.T) {
	q := sql.New(sql.From("http_logs"))
	customer := sql.Field("customer")
	pills := []Pill{
		pill(t, httpLogs, customer, "eq", "acme"),
		pill(t, httpLogs, sql.Field("status"), "ne", "500"),
		pill(t, httpLogs, customer, "eq", "globex"),
		pill(t, httpLogs, sql.Field("status"), "ne", "404"),
		pill(t, httpLogs, customer, "ne", "initech"),
		pill(t, httpLogs, sql.Field("timestamp"), "ge", "2026-10-31 10:00"),
		pill(t, httpLogs, sql.Field("timestamp"), "le", "2026-10-31 12:00"),
		pill(t, httpLogs, sql.Field("timestamp"), "ge", "2026-10-31 11:00"),
	}

	got, d := Apply(q, httpLogs, true, pills)

	want := "WHERE\n" +
		"    (((customer) = 'acme') OR ((customer) = 'globex'))\n" +
		"    AND (((status) != '500') AND ((status) != '404'))\n" +
		"    AND (((customer) != 'initech'))\n" +
		"    AND (((timestamp) >= '2026-10-31 10:00') AND ((timestamp) >= '2026-10-31 11:00'))\n" +
		"    AND (((timestamp) <= '2026-10-31 12:00'))"
	if !strings.Contains(got.Build(), want) || len(d.Ignored) > 0 {
		t.Errorf("ignored %v, query:\n%s", d.Ignored, got.Build())
	}
}

func TestApply_AColumnAndAComputedFieldOfOneNameAreTwoFields(t *testing.T) {
	q := sql.New(sql.From("http_logs"))
	pills := []Pill{
		pill(t, httpLogs, sql.ColumnField("host"), "eq", "web-1"),
		pill(t, httpLogs, sql.Field("lower(host_name)").WithAlias("host"), "eq", "shop"),
	}

	got, _ := Apply(q, httpLogs, true, pills)

	want := "WHERE\n    (((`host`) = 'web-1'))\n    AND (((lower(host_name)) = 'shop'))"
	if !strings.Contains(got.Build(), want) {
		t.Errorf("query:\n%s", got.Build())
	}
}

func TestApply_TwoBasesOnOneTableShareThePills(t *testing.T) {
	status := pill(t, httpLogs, sql.Field("status"), "eq", "500")
	for _, q := range []sql.SqlQueryable{
		sql.New(sql.From("http_logs"), sql.Where("path LIKE '/api%'")),
		sql.New(sql.From("default.http_logs")),
		sql.FromString("SELECT count() FROM http_logs WHERE {{DASHICA_FILTERS}}").With(sql.Table("http_logs")),
	} {
		table, ok := filters.TableOf(q)
		if got, _ := Apply(q, table, ok, []Pill{status}); !strings.Contains(got.Build(), "(status) = '500'") {
			t.Errorf("%T lacks the pill:\n%s", q, got.Build())
		}
	}
}

func TestApply_WithoutATableNone(t *testing.T) {
	q := sql.FromString("SELECT 1 WHERE {{DASHICA_FILTERS}}")
	status := pill(t, httpLogs, sql.Field("status"), "eq", "500")
	table, ok := filters.TableOf(q)
	got, d := Apply(q, table, ok, []Pill{status})
	if strings.Contains(got.Build(), "500") || !reflect.DeepEqual(d.Ignored, []string{"status = 500"}) {
		t.Errorf("ignored %v, query %s", d.Ignored, got.Build())
	}
}

func TestNewButton_WritesTheValueInAsAStringLiteral(t *testing.T) {
	errorsOnly, err := NewButton("Errors", "status >= 500", "")
	if want := (Pill{Condition: "status >= 500", Label: "Errors", Button: "status >= 500"}); err != nil || errorsOnly != want {
		t.Errorf("without ...: %+v, %v", errorsOnly, err)
	}
	path, err := NewButton("Path", "path ILIKE concat(..., '%') OR referer = ...", `it's\`)
	want := Pill{Condition: `path ILIKE concat('it\'s\\', '%') OR referer = 'it\'s\\'`, Label: `Path: it's\`, Button: "path ILIKE concat(..., '%') OR referer = ...", Value: `it's\`}
	if err != nil || path != want {
		t.Errorf("with ...: %+v, %v", path, err)
	}
	if _, err := NewButton("Errors", "status >= 500", "1"); err == nil {
		t.Errorf("a value accepted for a button without ...")
	}
	if _, err := NewButton("Path", "path = ...", ""); err == nil {
		t.Errorf("an empty value accepted")
	}
}

func TestSignAndOpen_GiveAButtonsPillBackLabelledWithItsCondition(t *testing.T) {
	for want, p := range map[string]Pill{
		"@duration_ms >= ...~500":    must(NewButton("Duration", "duration_ms >= ...", "500")),
		"@status >= 500":             must(NewButton("Errors", "status >= 500", "")),
		"@path = ... %7E 1~a%7Eb%25": must(NewButton("Path", "path = ... ~ 1", "a~b%")),
	} {
		key, err := filters.Sign(p)
		if head := key[:strings.LastIndex(key, "~")]; err != nil || head != want {
			t.Errorf("key %q, %v, want %q", key, err, want)
		}
		got, err := filters.Open(key)
		p.Label = p.Condition
		if err != nil || got != p {
			t.Errorf("Open(%q): %+v, %v, want %+v", key, got, err, p)
		}
	}
}

func must(p Pill, err error) Pill {
	if err != nil {
		panic(err)
	}
	return p
}

func TestApply_AButtonsPillToEveryQueryThatTakesFilters(t *testing.T) {
	errorsOnly, _ := NewButton("Errors", "level = 'error' OR level = 'fatal'", "")
	status := pill(t, httpLogs, sql.Field("status"), "eq", "500")
	for _, q := range []sql.SqlQueryable{
		sql.New(sql.From("http_logs")),
		sql.New(sql.From("full_logs"), sql.OnDatabase("logs")),
		sql.FromString("SELECT 1 WHERE {{DASHICA_FILTERS}}"),
	} {
		table, ok := filters.TableOf(q)
		got, d := Apply(q, table, ok, []Pill{errorsOnly, status})
		if !strings.Contains(got.Build(), "(level = 'error' OR level = 'fatal')") || slices.Contains(d.Ignored, "Errors") {
			t.Errorf("%T lacks the button, ignored %v:\n%s", q, d.Ignored, got.Build())
		}
	}

	q := sql.New(sql.From("http_logs"))
	got, _ := Apply(q, httpLogs, true, []Pill{errorsOnly, status})
	if want := "    (((status) = '500'))\n    AND (level = 'error' OR level = 'fatal')"; !strings.Contains(got.Build(), want) {
		t.Errorf("the button not after the fields:\n%s", got.Build())
	}

	skipping := sql.New(sql.From("http_logs"), sql.SkipFilters())
	table, ok := filters.TableOf(skipping)
	got, d := Apply(skipping, table, ok, []Pill{errorsOnly})
	if strings.Contains(got.Build(), "level") || !reflect.DeepEqual(d.Ignored, []string{"Errors"}) {
		t.Errorf("skips filters: ignored %v, query %s", d.Ignored, got.Build())
	}
}

func TestTableName_DropsTheConnectionsDatabase(t *testing.T) {
	for want, table := range map[string]Table{
		"http_logs":            httpLogs,
		"system.one":           {"default", "system.one"},
		"full_logs":            {"logs", "monitoring.full_logs"},
		"default.full_logs":    {"logs", "default.full_logs"},
		"default.http_logs_v2": {"other", "default.http_logs_v2"},
	} {
		if got := filters.TableName(table); got != want {
			t.Errorf("%+v: %q, want %q", table, got, want)
		}
	}
}
