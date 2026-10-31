// Tests for TableOf, New, NewButton, Sign, Open and Apply.
package filter

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

var secret = []byte("a test secret of at least thirty-two bytes")

// databases is dashica_config's database per connection: "default" on default, "monitoring" on logs.
func databases(connection string) string {
	return map[string]string{"default": "default", "logs": "monitoring"}[connection]
}

var httpLogs = Table{Connection: "default", Name: "default.http_logs"}

func pill(t *testing.T, table Table, field sql.SqlField, op sql.Op, value string) Pill {
	t.Helper()
	p, err := New(table, field, op, value, "")
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
		got, ok := TableOf(tt.q, databases)
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
	if _, err := New(httpLogs, sql.Count(), "eq", "1", ""); !errors.Is(err, ErrCannotFilter) {
		t.Errorf("count: %v", err)
	}
	if _, err := New(httpLogs, sql.Field("status"), "like", "5", ""); err == nil {
		t.Errorf("op like accepted")
	}
	since, err := New(httpLogs, sql.Field("timestamp"), "ge", "2026-10-31T10:00:00.000Z", "DateTime64(3)")
	want = Pill{Table: httpLogs, Field: "timestamp", Op: "ge", Condition: "(timestamp) >= '2026-10-31T10:00:00.000Z'",
		Label: "timestamp ≥ 2026-10-31T10:00:00.000Z", Value: "2026-10-31T10:00:00.000Z", Type: "DateTime64(3)"}
	if err != nil || since != want {
		t.Errorf("ge: %+v, %v", since, err)
	}
}

func TestSignAndOpen_GiveThePillBack(t *testing.T) {
	p, _ := New(httpLogs, sql.Field("status"), "le", "500", "UInt16")
	key, err := Sign(secret, p)
	if err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(key, "+/=&? ") {
		t.Errorf("key %q is not URL-safe", key)
	}
	got, err := Open(secret, key)
	if err != nil || got != p {
		t.Errorf("Open: %+v, %v", got, err)
	}
}

func TestSign_PutsAnEmptyValueIntoTheKey(t *testing.T) {
	key, err := Sign(secret, pill(t, httpLogs, sql.Field("host"), "eq", ""))
	if err != nil {
		t.Fatal(err)
	}
	payload, _, _ := strings.Cut(key, ".")
	b, _ := base64.RawURLEncoding.DecodeString(payload)
	var fields map[string]any
	if err := json.Unmarshal(b, &fields); err != nil || fields["value"] != "" {
		t.Errorf("payload %s: want \"value\": \"\"", b)
	}
}

func TestOpen_RefusesAKeyNotSignedByThisSecret(t *testing.T) {
	key, _ := Sign(secret, pill(t, httpLogs, sql.Field("status"), "eq", "500"))
	payload, signature, _ := strings.Cut(key, ".")

	// the condition changed on its way, the mac kept
	var p Pill
	b, _ := base64.RawURLEncoding.DecodeString(payload)
	_ = json.Unmarshal(b, &p)
	p.Condition = "1 = 1) OR (1 = 1"
	b, _ = json.Marshal(p)
	tampered := base64.RawURLEncoding.EncodeToString(b) + "." + signature
	// the shown value changed (the filter bar edits by it), the mac kept
	var shown Pill
	b, _ = base64.RawURLEncoding.DecodeString(payload)
	_ = json.Unmarshal(b, &shown)
	shown.Value = "200"
	b, _ = json.Marshal(shown)
	tamperedValue := base64.RawURLEncoding.EncodeToString(b) + "." + signature

	otherSecret, _ := Sign([]byte("another secret of at least thirty-two bytes"), p)
	for name, k := range map[string]string{
		"tampered":         tampered,
		"tampered value":   tamperedValue,
		"unsigned":         payload,
		"another secret":   otherSecret,
		"bad mac":          payload + ".x",
		"empty":            "",
		"the old filter f": "status:eq:500",
	} {
		if _, err := Open(secret, k); err == nil {
			t.Errorf("%s: opened", name)
		}
	}
	if _, err := Open(nil, key); err == nil {
		t.Errorf("opened without a secret")
	}
	if _, err := Sign(nil, p); err == nil {
		t.Errorf("signed without a secret")
	}
}

func TestApply_AddsThePillsOnItsTableAndNamesTheOthers(t *testing.T) {
	q := sql.New(sql.From("http_logs"))
	table, ok := TableOf(q, databases)
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

func TestApply_TwoBasesOnOneTableShareThePills(t *testing.T) {
	status := pill(t, httpLogs, sql.Field("status"), "eq", "500")
	for _, q := range []sql.SqlQueryable{
		sql.New(sql.From("http_logs"), sql.Where("path LIKE '/api%'")),
		sql.New(sql.From("default.http_logs")),
		sql.FromString("SELECT count() FROM http_logs WHERE {{DASHICA_FILTERS}}").With(sql.Table("http_logs")),
	} {
		table, ok := TableOf(q, databases)
		if got, _ := Apply(q, table, ok, []Pill{status}); !strings.Contains(got.Build(), "(status) = '500'") {
			t.Errorf("%T lacks the pill:\n%s", q, got.Build())
		}
	}
}

func TestApply_WithoutATableNone(t *testing.T) {
	q := sql.FromString("SELECT 1 WHERE {{DASHICA_FILTERS}}")
	status := pill(t, httpLogs, sql.Field("status"), "eq", "500")
	table, ok := TableOf(q, databases)
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

func TestSignAndOpen_GiveAButtonsPillBack(t *testing.T) {
	p, _ := NewButton("Duration", "duration_ms >= ...", "500")
	key, err := Sign(secret, p)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := Open(secret, key); err != nil || got != p {
		t.Errorf("Open: %+v, %v", got, err)
	}
}

func TestApply_AButtonsPillToEveryQueryThatTakesFilters(t *testing.T) {
	errorsOnly, _ := NewButton("Errors", "level = 'error' OR level = 'fatal'", "")
	status := pill(t, httpLogs, sql.Field("status"), "eq", "500")
	for _, q := range []sql.SqlQueryable{
		sql.New(sql.From("http_logs")),
		sql.New(sql.From("full_logs"), sql.OnDatabase("logs")),
		sql.FromString("SELECT 1 WHERE {{DASHICA_FILTERS}}"),
	} {
		table, ok := TableOf(q, databases)
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
	table, ok := TableOf(skipping, databases)
	got, d := Apply(skipping, table, ok, []Pill{errorsOnly})
	if strings.Contains(got.Build(), "level") || !reflect.DeepEqual(d.Ignored, []string{"Errors"}) {
		t.Errorf("skips filters: ignored %v, query %s", d.Ignored, got.Build())
	}
}
