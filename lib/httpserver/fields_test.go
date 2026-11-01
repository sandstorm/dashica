// Tests for HandleFields without ClickHouse: a chart without computed fields answers its table's columns alone; the
// DESCRIBE of its computed fields takes no SQL chips, and one that fails costs the columns nothing; fieldTypes asks
// each field on its own when they cannot be described together.
package httpserver

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TestHandleFields_WithoutComputedFieldsAsksClickHouseNothing(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/fields?time=1h", nil)
	state, err := ParseQueryState(r)
	if err != nil {
		t.Fatal(err)
	}
	columns := []clickhouse.SchemaColumn{{Name: "host", Type: "LowCardinality(String)", Comment: "the host"}}
	rec := httptest.NewRecorder()
	// no ClickHouse client: one asked would fail
	if err := (QueryHandler{}).HandleFields(columns, sql.New(sql.From("http_logs")), nil, state, rec, r); err != nil {
		t.Fatal(err)
	}
	if got, want := strings.TrimSpace(rec.Body.String()), `{"columns":[{"name":"host","type":"LowCardinality(String)"}],"computed":[]}`; got != want {
		t.Errorf("%s, want %s", got, want)
	}
	if rec.Header().Get("X-Dashica-Resolved-Time-Range") == "" {
		t.Errorf("no resolved time range")
	}
}

func TestHandleFields_TakesNoSqlChipsAndAFailedDescribeKeepsTheColumns(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/fields?time=1h&sql=nonsense", nil)
	state, err := ParseQueryState(r)
	if err != nil {
		t.Fatal(err)
	}
	// sql_filter_enabled off: a chip that reached the DESCRIBE would be ErrSqlNotEnabled
	cfg := &config.Config{ClickHouse: map[string]config.ClickHouseConfig{"default": {URL: "http://127.0.0.1:1", Database: "default"}}}
	var logged bytes.Buffer
	qh := QueryHandler{ClickhouseClientManager: clickhouse.NewManager(cfg, zerolog.Nop()), Config: cfg, Logger: zerolog.New(&logged)}
	columns := []clickhouse.SchemaColumn{{Name: "host_name", Type: "String"}}
	rec := httptest.NewRecorder()
	if err := qh.HandleFields(columns, sql.New(sql.From("http_logs")), []sql.SqlField{sql.Field("lower(host_name)").WithAlias("host")}, state, rec, r); err != nil {
		t.Fatal(err)
	}
	if got, want := strings.TrimSpace(rec.Body.String()), `{"columns":[{"name":"host_name","type":"String"}],"computed":[]}`; got != want {
		t.Errorf("%s, want %s", got, want)
	}
	// the ClickHouse of cfg is unreachable: the request got to the DESCRIBE
	if !strings.Contains(logged.String(), "clickhouse describe") || strings.Contains(logged.String(), "sql_filter_enabled") {
		t.Errorf("logged %s", logged.String())
	}
}

func TestFieldTypes_OneDescribeOfAllElseOneOfEach(t *testing.T) {
	host, level := sql.Field("lower(host)").WithAlias("host"), sql.Field("max(level)").WithAlias("level")
	var asked [][]string
	// lower(host) and max(level) cannot be selected together without a GROUP BY; max(level) alone fails here too
	describe := func(fields []sql.SqlField) ([]clickhouse.ResultColumn, error) {
		var aliases []string
		for _, f := range fields {
			aliases = append(aliases, f.Alias())
		}
		asked = append(asked, aliases)
		if len(fields) == 1 && fields[0].Alias() == "host" {
			return []clickhouse.ResultColumn{{Name: "host", Type: "String"}}, nil
		}
		return nil, errors.New("NOT_AN_AGGREGATE")
	}
	got, err := fieldTypes([]sql.SqlField{host, level}, describe)
	if want := []clickhouse.ResultColumn{{Name: "host", Type: "String"}}; !slices.Equal(got, want) {
		t.Errorf("%v, want %v", got, want)
	}
	if err == nil || !strings.Contains(err.Error(), "level: clickhouse describe: NOT_AN_AGGREGATE") {
		t.Errorf("error %v", err)
	}
	if want := "[[host level] [host] [level]]"; fmt.Sprint(asked) != want {
		t.Errorf("asked %v, want %s", asked, want)
	}

	asked = nil
	got, err = fieldTypes([]sql.SqlField{host}, describe)
	if err != nil || len(got) != 1 || fmt.Sprint(asked) != "[[host]]" {
		t.Errorf("one field that describes: %v %v, asked %v", got, err, asked)
	}
}
