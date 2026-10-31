// Tests for the pills a chart's query handler makes and applies (queryHandler, pillHandler, filterableFields), a
// filter button's among them, the values it offers for them (valuesHandler), its table's columns (columnsHandler)
// without a schema, the table and computed fields its node names and the pills of Speedscope's query.
package widget

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

var testSecret = []byte("a test secret of at least thirty-two bytes")

// testFiles are the SQL files of the test charts: colors.sql selects a constant colour beside its hosts.
var testFiles = fstest.MapFS{"colors.sql": {Data: []byte("SELECT host, 'darkred' AS color, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY host")}}

// testDeps are the dependencies of a chart's handler on a ClickHouse that is unreachable (the EXPLAINs of /debug fail
// and stay unchecked, so does its schema), its connection "default" on the database "default", the pills signed with
// testSecret, SQL chips and Explore off, its SQL files testFiles.
func testDeps() rendering.Dependencies {
	unreachable := map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1", Database: "default"}}
	cfg := &config.Config{ClickHouse: unreachable, Filters: config.FiltersConfig{Secret: string(testSecret)}}
	return rendering.Dependencies{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Config: cfg, FileSystem: testFiles}
}

// askPath is the answer of `chart`'s handler to `path` (with its query string).
func askPath(chart withQuery, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	queryHandler(testDeps(), chart).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// pillOf is the key `chart`'s /pill gives for `field` `op` `value`; it fails the test on another answer.
func pillOf(t *testing.T, chart withQuery, field, op, value string) string {
	t.Helper()
	rec := askPath(chart, "/pill?"+url.Values{"field": {field}, "op": {op}, "value": {value}}.Encode())
	var body struct{ Key, Label string }
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &body) != nil || body.Key == "" {
		t.Fatalf("/pill %s %s %s: %d %s", field, op, value, rec.Code, rec.Body)
	}
	return body.Key
}

// debugged is what a chart's /debug answers about its pills: the query and the Diagnostics (decoded).
type debugged struct {
	status      int
	diagnostics string
	query       string
}

// debug asks /debug of `chart` with `time=1h` and the pills `keys`.
func debug(t *testing.T, chart withQuery, keys ...string) debugged {
	t.Helper()
	rec := askPath(chart, "/debug?"+url.Values{"time": {"1h"}, "f": keys}.Encode())
	diagnostics, err := url.PathUnescape(rec.Header().Get("X-Dashica-Diagnostics"))
	if err != nil {
		t.Fatalf("diagnostics header: %v", err)
	}
	got := debugged{status: rec.Code, diagnostics: diagnostics}
	if rec.Code != http.StatusOK {
		return got
	}
	var body struct{ Query string }
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("debug body %s: %v", rec.Body, err)
	}
	got.query = body.Query
	return got
}

func TestPill_IsTheFieldsConditionSignedAndLabelledWithItsFieldAndValue(t *testing.T) {
	bar := NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.JsonExtractString("attrs", "host")).Y(sql.Count())

	rec := askPath(bar, "/pill?field=host&op=ne&value=it's")
	var body struct{ Key, Label string }
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	pill, err := filter.Open(testSecret, body.Key, testDeps().ClickhouseClientManager.Database)
	if rec.Code != http.StatusOK || err != nil || body.Label != "host ≠ it's" {
		t.Fatalf("%d %s, %v", rec.Code, rec.Body, err)
	}
	want := filter.Pill{Table: filter.Table{Connection: "default", Name: "default.http_logs"}, Field: "host", Op: "ne", Condition: `(JSONExtractString(attrs, 'host')) != 'it\'s'`, Label: "host ≠ it's", Value: "it's"}
	if pill != want {
		t.Errorf("pill %+v", pill)
	}
}

func TestPill_AFieldThatIsJustAColumnMakesTheColumnsPill(t *testing.T) {
	table := NewTable(sql.New(sql.From("http_logs"), sql.Select(sql.Field("timestamp")), sql.Select(sql.Field("status"))))

	rec := askPath(table, "/pill?"+url.Values{"field": {"timestamp"}, "op": {"ge"}, "value": {"2026-10-31T10:00:00.000Z"}}.Encode())
	var body struct{ Key, Label string }
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	pill, err := filter.Open(testSecret, body.Key, testDeps().ClickhouseClientManager.Database)
	if rec.Code != http.StatusOK || err != nil || body.Label != "timestamp ≥ 2026-10-31T10:00:00.000Z" {
		t.Fatalf("%d %s, %v", rec.Code, rec.Body, err)
	}
	if pill.Condition != "(`timestamp`) >= '2026-10-31T10:00:00.000Z'" || pill.Op != sql.OpGe || !pill.Column {
		t.Errorf("pill %+v", pill)
	}
	if want := "http_logs.timestamp>=2026-10-31T10:00:00.000Z~"; !strings.HasPrefix(body.Key, want) || len(body.Key) != len(want)+22 {
		t.Errorf("key %q, want %q and the mac", body.Key, want)
	}
}

func TestPill_AFieldThatCannotFilterIs422(t *testing.T) {
	bar := NewTimeBar(sql.New(sql.From("http_logs"))).X(sql.Timestamp15Min()).Y(sql.Count()).Fill(sql.Field("status"))
	noTable := NewBarVertical(sql.FromString("SELECT host, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY host")).X(sql.NewFieldAlias("host")).Y(sql.NewFieldAlias("cnt"))
	colour := NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count()).Fill(sql.Field("'darkred'").WithAlias("darkred"))
	colours := NewBarVertical(sql.FromFile("colors.sql", sql.Table("http_logs"))).X(sql.NewFieldAlias("host")).Y(sql.NewFieldAlias("cnt")).Fill(sql.NewFieldAlias("color"))
	for name, tt := range map[string]struct {
		chart withQuery
		field string
	}{
		"a count":                    {bar, "cnt"},
		"a time bucket":              {bar, "time"},
		"no field of it":             {bar, "path"},
		"a SQL file without a table": {noTable, "host"},
		"a constant":                 {colour, "darkred"},
		"a SQL file's constant":      {colours, "color"},
	} {
		if rec := askPath(tt.chart, "/pill?op=eq&value=1&field="+tt.field); rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	for _, query := range []string{"field=status&op=like&value=1", "field=status&op=eq"} {
		if rec := askPath(bar, "/pill?"+query); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", query, rec.Code)
		}
	}
}

func TestQueryHandler_AppliesThePillsOnItsTableAndNamesTheOthers(t *testing.T) {
	logs := sql.New(sql.From("http_logs"))
	bar := NewBarVertical(logs).X(sql.JsonExtractString("attrs", "host")).Y(sql.Count())
	other := NewBarVertical(sql.New(sql.From("caddy_logs"))).X(sql.Field("upstream")).Y(sql.Count())
	host := pillOf(t, bar, "host", "eq", "shop")
	upstream := pillOf(t, other, "upstream", "eq", "a")

	got := debug(t, bar, host, upstream)

	if got.diagnostics != `{"ignored":["upstream = a"]}` {
		t.Errorf("diagnostics %q", got.diagnostics)
	}
	if want := "((JSONExtractString(attrs, 'host')) = 'shop')"; !strings.Contains(got.query, want) {
		t.Errorf("query lacks %s:\n%s", want, got.query)
	}
}

func TestQueryHandler_AnotherChartOnTheTableTakesThePillAsItWasMade(t *testing.T) {
	// the pill holds the condition of the chart it was made on; a chart with another field of that alias applies it
	byHost := NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.JsonExtractString("attrs", "host")).Y(sql.Count())
	byPath := NewTimeBar(sql.New(sql.From("default.http_logs"), sql.Where("path != '/'"))).X(sql.Timestamp15Min()).Y(sql.Count()).Fill(sql.Field("path"))

	got := debug(t, byPath, pillOf(t, byHost, "host", "eq", "shop"))

	if !strings.Contains(got.query, "(JSONExtractString(attrs, 'host')) = 'shop'") || got.diagnostics != "" {
		t.Errorf("diagnostics %q, query:\n%s", got.diagnostics, got.query)
	}
}

func TestQueryHandler_ASqlFileWithTableTakesThePillsAtItsPlaceholder(t *testing.T) {
	file := NewBarVertical(sql.FromString("SELECT host, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY host").With(sql.Table("http_logs"))).
		X(sql.NewFieldAlias("host")).Y(sql.NewFieldAlias("cnt"))

	got := debug(t, file, pillOf(t, file, "host", "ne", "shop"))

	if !strings.Contains(got.query, "WHERE (((host) != 'shop')) AND (timestamp >= ") {
		t.Errorf("query:\n%s", got.query)
	}
}

func TestQueryHandler_ATamperedPillIsABadRequest(t *testing.T) {
	bar := NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count())
	key := pillOf(t, bar, "status", "eq", "500")
	payload, _, _ := strings.Cut(key, ".")
	for name, k := range map[string]string{"unsigned": payload, "the old filter": "status:eq:500", "bad mac": payload + ".AAAA"} {
		if got := debug(t, bar, k); got.status != http.StatusBadRequest {
			t.Errorf("%s: %d", name, got.status)
		}
	}
}

func TestQueryHandler_ASqlChipIsABadRequestWhileSqlFiltersAreOff(t *testing.T) {
	bar := NewTimeBar(sql.New(sql.From("http_logs"))).X(sql.Timestamp15Min()).Y(sql.Count()).Fill(sql.Field("status"))
	chip := "&sql=" + url.QueryEscape("status >= 500")
	// Explore on, so that /sql gets to the query
	ask := func(sqlEnabled bool, path string) *httptest.ResponseRecorder {
		deps := testDeps()
		deps.Config.Explore.Enabled, deps.Config.Filters.SqlEnabled = true, sqlEnabled
		rec := httptest.NewRecorder()
		queryHandler(deps, bar).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path+chip, nil))
		return rec
	}
	for _, path := range []string{"/query?time=1h", "/debug?time=1h", "/rows?time=1h", "/sql?time=1h", "/values?time=1h&field=status", "/type?time=1h&field=status"} {
		if rec := ask(false, path); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "filters.sqlEnabled") {
			t.Errorf("off, %s: %d %s", path, rec.Code, rec.Body)
		}
		// on, the same request passes: the ClickHouse of testDeps is unreachable
		if rec := ask(true, path); rec.Code == http.StatusBadRequest {
			t.Errorf("on, %s: %d %s", path, rec.Code, rec.Body)
		}
	}
}

func TestQueryHandler_AButtonsPillAppliesWithoutATable(t *testing.T) {
	button, _ := filter.NewButton("Duration", "duration_ms >= ...", "500")
	key, _ := filter.Sign(testSecret, button, nil)
	noTable := NewBarVertical(sql.FromString("SELECT host, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY host")).X(sql.NewFieldAlias("host")).Y(sql.NewFieldAlias("cnt"))
	other := NewBarVertical(sql.New(sql.From("caddy_logs"))).X(sql.Field("upstream")).Y(sql.Count())
	for name, chart := range map[string]withQuery{"a SQL file without a table": noTable, "a chart on another table": other} {
		if got := debug(t, chart, key); !strings.Contains(got.query, "(duration_ms >= '500')") || got.diagnostics != "" {
			t.Errorf("%s: %+v", name, got)
		}
	}
}

func TestSpeedscope_ASqlChipIsABadRequestWhileSqlFiltersAreOff(t *testing.T) {
	link := NewSpeedscopeLink(sql.New(sql.From("http_logs")))
	target := "/speedscope-query?time=1h&sql=" + url.QueryEscape("status >= 500")
	rec := httptest.NewRecorder()
	link.Handler(testDeps()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "filters.sqlEnabled") {
		t.Errorf("off: %d %s", rec.Code, rec.Body)
	}
	// on, the same request passes: the ClickHouse of testDeps is unreachable
	deps := testDeps()
	deps.Config.Filters.SqlEnabled = true
	rec = httptest.NewRecorder()
	link.Handler(deps).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	if rec.Code == http.StatusBadRequest {
		t.Errorf("on: %d %s", rec.Code, rec.Body)
	}
}

func TestSpeedscope_ATamperedPillIsABadRequest(t *testing.T) {
	link := NewSpeedscopeLink(sql.New(sql.From("http_logs")))
	rec := httptest.NewRecorder()
	link.Handler(testDeps()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/speedscope-query?time=1h&f=status:eq:500", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
}

func TestQueryHandler_AQueryThatSkipsFiltersIgnoresAll(t *testing.T) {
	bar := NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count())
	skips := NewBarVertical(sql.New(sql.From("http_logs"), sql.SkipFilters())).X(sql.Field("status")).Y(sql.Count())
	got := debug(t, skips, pillOf(t, bar, "status", "eq", "500"))
	if got.diagnostics != `{"ignored":["status = 500"]}` || strings.Contains(got.query, "'500'") {
		t.Errorf("want everything ignored: %+v", got)
	}
}

func TestFilterableFields_TheCategoriesOfAChartWithATable(t *testing.T) {
	logs := sql.New(sql.From("http_logs"))
	aliases := func(chart withQuery) []string {
		var out []string
		for _, f := range filterableFields(testDeps(), chart) {
			out = append(out, f.Alias())
		}
		return out
	}
	tests := map[string]struct {
		chart withQuery
		want  []string
	}{
		"time bar":            {NewTimeBar(logs).X(sql.Timestamp15Min()).Y(sql.Count()).Fill(sql.Field("status")), []string{"status"}},
		"bar":                 {NewBarVertical(logs).X(sql.Field("path")).Y(sql.Count()).Fill(sql.Field("status")), []string{"path", "status"}},
		"skips filters":       {NewBarVertical(sql.New(sql.From("http_logs"), sql.SkipFilters())).X(sql.Field("path")).Y(sql.Count()), nil},
		"SQL file":            {NewBarVertical(sql.FromFile("x.sql")).X(sql.NewFieldAlias("path")).Y(sql.NewFieldAlias("cnt")), nil},
		"SQL file with Table": {NewBarVertical(sql.FromFile("x.sql", sql.Table("http_logs"))).X(sql.NewFieldAlias("path")).Y(sql.NewFieldAlias("cnt")), []string{"path"}},
		"a constant fill":     {NewBarVertical(logs).X(sql.Field("path")).Y(sql.Count()).Fill(sql.Field("'#D73027'").WithAlias("darkred")), []string{"path"}},
		"an unnamed constant": {NewBarVertical(logs).X(sql.Field("path")).Y(sql.Count()).Fill(sql.Field("'darkred'")), []string{"path"}},
		"a SQL file's constant": {
			NewBarVertical(sql.FromFile("colors.sql", sql.Table("http_logs"))).X(sql.NewFieldAlias("host")).Y(sql.NewFieldAlias("cnt")).Fill(sql.NewFieldAlias("color")),
			[]string{"host"},
		},
	}
	for name, tt := range tests {
		if got := aliases(tt.chart); !slices.Equal(got, tt.want) {
			t.Errorf("%s: %v, want %v", name, got, tt.want)
		}
	}
}

func TestValues_AFieldThatCannotFilterIs422AnUnsignedPill400(t *testing.T) {
	bar := NewTimeBar(sql.New(sql.From("http_logs"))).X(sql.Timestamp15Min()).Y(sql.Count()).Fill(sql.Field("status"))
	noTable := NewBarVertical(sql.FromString("SELECT host, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY host")).X(sql.NewFieldAlias("host")).Y(sql.NewFieldAlias("cnt"))
	for _, path := range []string{"/values", "/type"} {
		for name, tt := range map[string]struct {
			chart withQuery
			field string
		}{
			"a count":                    {bar, "cnt"},
			"a time bucket":              {bar, "time"},
			"no field of it":             {bar, "path"},
			"a SQL file without a table": {noTable, "host"},
		} {
			if rec := askPath(tt.chart, path+"?time=1h&field="+tt.field); rec.Code != http.StatusUnprocessableEntity {
				t.Errorf("%s, %s: %d %s", path, name, rec.Code, rec.Body)
			}
		}
		if rec := askPath(bar, path+"?time=1h&field=status&f=status:eq:500"); rec.Code != http.StatusBadRequest {
			t.Errorf("%s, unsigned pill: %d %s", path, rec.Code, rec.Body)
		}
		if rec := askPath(bar, path+"?field=status"); rec.Code != http.StatusBadRequest {
			t.Errorf("%s, no time range: %d %s", path, rec.Code, rec.Body)
		}
		// the ClickHouse of testDeps is unreachable: a request that passed every check fails there
		if rec := askPath(bar, path+"?time=1h&field=status&search=50"); rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "clickhouse") {
			t.Errorf("%s, a field that filters: %d %s", path, rec.Code, rec.Body)
		}
	}
}

func TestOthersThan_LeavesTheOtherFieldOfTheSameName(t *testing.T) {
	logs := filter.Table{Connection: "default", Name: "default.http_logs"}
	newPill := func(field sql.SqlField, value string) filter.Pill {
		p, err := filter.New(logs, field, sql.OpEq, value)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	column := newPill(sql.ColumnField("host"), "web-1")
	computed := newPill(sql.Field("lower(host_name)").WithAlias("host"), "shop")
	other := newPill(sql.ColumnField("host"), "web-2")
	other.Table = filter.Table{Connection: "logs", Name: "monitoring.full_logs"}
	pills := []filter.Pill{column, computed, other}

	if got := othersThan(pills, logs, "host", true); !reflect.DeepEqual(got, []filter.Pill{computed, other}) {
		t.Errorf("the column's: %+v", got)
	}
	if got := othersThan(pills, logs, "host", false); !reflect.DeepEqual(got, []filter.Pill{column, other}) {
		t.Errorf("the computed field's: %+v", got)
	}
	if len(pills) != 3 {
		t.Errorf("pills changed: %+v", pills)
	}
}

func TestMount_AChartWithATableNamesIt(t *testing.T) {
	_, _, _, page := mountPage(t,
		NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count()),
		NewBarVertical(sql.New(sql.From("audit"), sql.OnDatabase("logs"))).X(sql.Field("action")).Y(sql.Count()),
		NewStats(sql.New(sql.From("payments"))),
		NewStats(sql.New(sql.From("payments"), sql.SkipFilters())),
		pathEcho{},
	)

	if got := []string{page[0].Table, page[1].Table, page[2].Table, page[3].Table, page[4].Table}; !slices.Equal(got, []string{"http_logs", "audit", "payments", "", ""}) {
		t.Errorf("tables %q", got)
	}
}

func TestMount_TheComputedFieldsAreThoseThatAreMoreThanAColumn(t *testing.T) {
	_, _, _, page := mountPage(t,
		NewBarVertical(sql.New(sql.From("http_logs"))).
			X(sql.Field("replaceOne(customer_project, 'oekokiste.', '')").WithAlias("instance")).
			Y(sql.Count()).
			Fill(sql.Field("host_name")),
		NewTimeBar(sql.New(sql.From("http_logs"))).X(sql.Timestamp15Min()).Y(sql.Count()).
			Fill(sql.Field("customer_project").WithAlias("project")),
		NewBarVertical(sql.FromFile("colors.sql", sql.Table("http_logs"))).X(sql.NewFieldAlias("host")).Y(sql.NewFieldAlias("cnt")).Fill(sql.NewFieldAlias("color")),
	)

	for i, want := range []struct{ filterable, computed []string }{
		{[]string{"instance", "host_name"}, []string{"instance"}},
		{[]string{"project"}, []string{"project"}},
		{[]string{"host"}, []string{"host"}},
	} {
		if !slices.Equal(page[i].Filterable, want.filterable) || !slices.Equal(page[i].Computed, want.computed) {
			t.Errorf("chart %d: filterable %q, computed %q", i, page[i].Filterable, page[i].Computed)
		}
	}
}

func TestColumns_AChartWithoutATableIs422TheSchemaAskedOtherwise(t *testing.T) {
	bar := NewBarVertical(sql.New(sql.From("http_logs"))).X(sql.Field("status")).Y(sql.Count())
	noTable := NewBarVertical(sql.FromString("SELECT host, count() AS cnt FROM http_logs WHERE {{DASHICA_FILTERS}} GROUP BY host")).X(sql.NewFieldAlias("host")).Y(sql.NewFieldAlias("cnt"))
	for _, path := range []string{"/columns?time=1h", "/pill?op=eq&value=1&column=host", "/values?time=1h&column=host", "/type?time=1h&column=host"} {
		if rec := askPath(noTable, path); rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("no table, %s: %d %s", path, rec.Code, rec.Body)
		}
		// the ClickHouse of testDeps is unreachable, so is its schema: the column is never taken on the client's word
		if rec := askPath(bar, path); rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "system.tables") {
			t.Errorf("a table, %s: %d %s", path, rec.Code, rec.Body)
		}
	}
	if rec := askPath(bar, "/columns"); rec.Code != http.StatusBadRequest {
		t.Errorf("no time range: %d %s", rec.Code, rec.Body)
	}
}
