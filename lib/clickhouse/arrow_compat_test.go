package clickhouse

import (
	"strings"
	"testing"
)

func TestArrowUnsafeType(t *testing.T) {
	cases := []struct {
		chType string
		want   bool
	}{
		{"JSON", true},
		{"Object('json')", true},
		{"Dynamic", true},
		{"Variant(String, UInt64)", true},
		{"Nullable(JSON)", true},
		{"Array(JSON)", true},
		{"String", false},
		{"LowCardinality(String)", false},
		{"DateTime64(6)", false},
		{"UInt64", false},
		{"Map(String, String)", false},
	}
	for _, tc := range cases {
		if got := arrowUnsafeType(tc.chType); got != tc.want {
			t.Errorf("arrowUnsafeType(%q) = %v, want %v", tc.chType, got, tc.want)
		}
	}
}

func TestTrimTrailingSemicolons(t *testing.T) {
	cases := map[string]string{
		"SELECT 1":            "SELECT 1",
		"SELECT 1;":           "SELECT 1",
		"SELECT 1;\n":         "SELECT 1",
		"SELECT 1 ;  \n\t":    "SELECT 1",
		"SELECT 1;;\n":        "SELECT 1",
		"SELECT * FROM t\n\n": "SELECT * FROM t",
	}
	for in, want := range cases {
		if got := trimTrailingSemicolons(in); got != want {
			t.Errorf("trimTrailingSemicolons(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildArrowWrap(t *testing.T) {
	got, ok := buildArrowWrap("SELECT * FROM full_logs", []describeRow{{"event_original", "JSON"}, {"host", "String"}, {"attrs", "Dynamic"}}, castArrowUnsafe)

	if !ok {
		t.Fatal("JSON and Dynamic are cast")
	}
	for _, want := range []string{
		"SELECT * REPLACE(",
		"toString(`event_original`) AS `event_original`",
		"toString(`attrs`) AS `attrs`",
		"FROM (",
		"SELECT * FROM full_logs",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("wrap missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "`host`") {
		t.Errorf("host is a String:\n%s", got)
	}
}

func TestBuildArrowWrap_KeepsAQueryWhoseColumnsItKeeps(t *testing.T) {
	got, ok := buildArrowWrap("SELECT 1", []describeRow{{"host", "String"}}, castArrowUnsafe)

	if ok || got != "SELECT 1" {
		t.Errorf("got %q, %v", got, ok)
	}
}

func TestPlainArrowCast(t *testing.T) {
	cases := map[string]string{
		"String":                           "",
		"LowCardinality(Nullable(String))": "",
		"Nullable(UInt32)":                 "",
		"Bool":                             "",
		"Float64":                          "",
		"Date32":                           "",
		"DateTime64(3)":                    "",
		"DateTime64(3, 'Europe/Berlin')":   "",
		"DateTime":                         "toDateTime64(`c`, 3)",
		"DateTime('UTC')":                  "toDateTime64(`c`, 3)",
		"Nullable(DateTime64(9, 'UTC'))":   "toDateTime64(`c`, 3)",
		"Date":                             "toDate32(`c`)",
		"UInt64":                           "toFloat64(`c`)",
		"Int128":                           "toFloat64(`c`)",
		"Decimal(18, 2)":                   "toFloat64(`c`)",
		"Enum8('a' = 1)":                   "toString(`c`)",
		"UUID":                             "toString(`c`)",
		"IPv4":                             "toString(`c`)",
		"FixedString(2)":                   "toString(`c`)",
		"Map(String, String)":              "toString(`c`)",
		"Array(UInt8)":                     "toString(`c`)",
		"Tuple(String, UInt8)":             "toString(`c`)",
		"JSON":                             "toString(`c`)",
	}
	for chType, want := range cases {
		if got := PlainArrowCast("`c`", chType); got != want {
			t.Errorf("%s: got %q, want %q", chType, got, want)
		}
	}
}
