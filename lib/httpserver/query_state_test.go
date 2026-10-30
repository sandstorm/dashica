package httpserver

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
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
		"SQL filter and params": {
			query: url.Values{"time": {"24h"}, "sql": {"status >= 500"}, "wp": {`{"path":"^/api"}`}},
			want:  QueryState{Time: "24h", Sql: "status >= 500", Params: map[string]string{"path": "^/api"}},
		},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			got := parseQueryState(t, tt.query.Encode())
			if got.Time != tt.want.Time || got.Range != tt.want.Range || got.Sql != tt.want.Sql || !reflect.DeepEqual(got.Params, tt.want.Params) {
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
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("ParseQueryState: err = %v, want one saying %s", err, tt.want)
			}
		})
	}
}
