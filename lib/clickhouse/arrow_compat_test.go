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
	got := buildArrowWrap("SELECT * FROM full_logs", []string{"event_original", "attrs"})

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
}
