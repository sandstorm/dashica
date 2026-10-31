package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/filter"
)

// parseQueryState is the query state of a request with the query string `query`; it fails the test on an error.
func parseQueryState(t *testing.T, query string) QueryState {
	t.Helper()
	s, err := ParseQueryState(httptest.NewRequest(http.MethodGet, "/query?"+query, nil))
	if err != nil {
		t.Fatalf("ParseQueryState(%q): %v", query, err)
	}
	return s
}

func TestParseQueryState(t *testing.T) {
	tests := map[string]struct {
		query url.Values
		want  QueryState
	}{
		"preset": {
			query: url.Values{"time": {"1h"}},
			want:  QueryState{Time: "1h"},
		},
		"custom": {
			query: url.Values{"time": {"custom"}, "range": {"now-6h to now-1h"}},
			want:  QueryState{Time: "custom", Range: "now-6h to now-1h"},
		},
		"pills as their keys, unchecked, empty ones left out": {
			query: url.Values{"time": {"1h"}, "f": {"eyJ.abc", "", "status:eq:500"}},
			want:  QueryState{Time: "1h", Pills: []string{"eyJ.abc", "status:eq:500"}},
		},
		"SQL filter and params": {
			query: url.Values{"time": {"24h"}, "sql": {"status >= 500"}, "wp": {`{"path":"^/api"}`}},
			want:  QueryState{Time: "24h", Sql: []string{"status >= 500"}, Params: map[string]string{"path": "^/api"}},
		},
		"SQL chips in URL order, empty ones left out": {
			query: url.Values{"time": {"1h"}, "sql": {"status >= 500", "", " ", "a \nAND b"}},
			want:  QueryState{Time: "1h", Sql: []string{"status >= 500", "a \nAND b"}},
		},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			got := parseQueryState(t, tt.query.Encode())
			if got.Time != tt.want.Time || got.Range != tt.want.Range || !reflect.DeepEqual(got.Sql, tt.want.Sql) ||
				!reflect.DeepEqual(got.Pills, tt.want.Pills) || !reflect.DeepEqual(got.Params, tt.want.Params) {
				t.Errorf("ParseQueryState = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestParseQueryState_SaysWhatIsWrong(t *testing.T) {
	tests := map[string]struct {
		query url.Values
		want  string
	}{
		"missing time":     {query: url.Values{"sql": {"status >= 500"}}, want: "time range missing"},
		"bad duration":     {query: url.Values{"time": {"2d"}}, want: `"2d"`},
		"negative":         {query: url.Values{"time": {"-1h"}}, want: `"-1h"`},
		"wp not JSON":      {query: url.Values{"time": {"1h"}, "wp": {"path=^/api"}}, want: "wp"},
		"wp not strings":   {query: url.Values{"time": {"1h"}, "wp": {`{"limit":10}`}}, want: "wp"},
		"wp not an object": {query: url.Values{"time": {"1h"}, "wp": {`["^/api"]`}}, want: "wp"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := ParseQueryState(httptest.NewRequest(http.MethodGet, "/query?"+tt.query.Encode(), nil))
			var bad *QueryStateError
			if !errors.As(err, &bad) || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("ParseQueryState: err = %v, want a QueryStateError saying %s", err, tt.want)
			}
		})
	}
}

func TestWriteDiagnostics_OmitsTheHeaderForNothingToSay(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteDiagnostics(rec, filter.Diagnostics{})
	if _, ok := rec.Header()["X-Dashica-Diagnostics"]; ok {
		t.Errorf("header set: %v", rec.Header())
	}
	WriteDiagnostics(rec, filter.Diagnostics{Ignored: []string{"host", "status"}})
	if got := rec.Header().Get("X-Dashica-Diagnostics"); got != `%7B%22ignored%22:%5B%22host%22%2C%22status%22%5D%7D` {
		t.Errorf("header %q", got)
	}
}

func TestWriteDiagnostics_PercentEncodesNonASCII(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteDiagnostics(rec, filter.Diagnostics{Ignored: []string{"customer ≠ acme", "user = Jörg 🦊"}})
	got := rec.Header().Get("X-Dashica-Diagnostics")
	for _, r := range got {
		if r > 0x7e {
			t.Fatalf("header %q has a non-ASCII rune %q", got, r)
		}
	}
	text, err := url.PathUnescape(got)
	if err != nil {
		t.Fatalf("header %q: %v", got, err)
	}
	var back filter.Diagnostics
	if err := json.Unmarshal([]byte(text), &back); err != nil || back.Ignored[0] != "customer ≠ acme" || back.Ignored[1] != "user = Jörg 🦊" {
		t.Errorf("round trip %v %v", back, err)
	}
}
