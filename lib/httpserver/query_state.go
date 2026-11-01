package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/sandstorm/dashica/lib/dashboard/filter"
)

// QueryState is the page's query state as every data handler reads it, from the keys the page keeps in its own URL
// (`?time=1h&f=<key>&sql=status >= 500&wp={"path":"^/api"}`; see docs/2026-10-28-workbench.md §3.7). ParseQueryState
// reads it once per request; the handler resolves its window with ResolveTimeRange and adds SqlClause to the query's
// WHERE, the chart the pills on its table (filter.FilterService.Open, filter.Apply).
type QueryState struct {
	// Time is the time range: a preset as a Go duration (`1h`, `168h`), or `custom` for Range.
	Time string
	// Range is the custom range, `<from> to <to>`, each end a time expression (`2026-10-29 10:00`, `now-6h`).
	Range string
	// Pills are the keys of the pills (`f`, filter.FilterService.Sign), in the order of the URL, not yet checked:
	// filter.FilterService.Open checks each.
	Pills []string
	// Sql are the SQL chips, in the order of the URL (one `sql` each); every query adds each to its WHERE.
	Sql []string
	// Params are the values of the page's form widgets by name, bound as ClickHouse parameters (`param_<name>`).
	Params map[string]string
	// preset is Time as a duration; 0 for `custom`.
	preset time.Duration
}

// QueryStateError is what ParseQueryState cannot read; a handler answers it with 400.
type QueryStateError struct {
	Reason string
}

func (e *QueryStateError) Error() string {
	return e.Reason
}

// ErrSqlNotEnabled is what SqlClause answers SQL chips with while filters.sqlEnabled is off, before any query.
var ErrSqlNotEnabled = &QueryStateError{"SQL filters are not enabled (filters.sqlEnabled)"}

// ParseQueryState reads the query state of `r`: `time`, `range`, each `f` and each `sql` (an empty one left out) and
// `wp` (a JSON object of strings). The QueryStateError says what cannot be read: a missing `time`, a `time` that is
// neither a Go duration nor `custom`, a `wp` that is not such an object. An unreadable `range` is ResolveTimeRange's
// error; SQL chips while filters.sqlEnabled is off are SqlClause's, where they would enter a query.
func ParseQueryState(r *http.Request) (QueryState, error) {
	query := r.URL.Query()
	s := QueryState{Time: query.Get("time"), Range: query.Get("range")}
	for _, chip := range query["sql"] {
		if strings.TrimSpace(chip) != "" {
			s.Sql = append(s.Sql, chip)
		}
	}
	if s.Time == "" {
		return QueryState{}, &QueryStateError{"time range missing: want `time=<Go duration>` or `time=custom&range=<from> to <to>`"}
	}
	if s.Time != "custom" {
		dur, err := time.ParseDuration(s.Time)
		if err != nil || dur <= 0 {
			return QueryState{}, &QueryStateError{fmt.Sprintf("time range %q: neither a Go duration (`1h`) nor `custom`", s.Time)}
		}
		s.preset = dur
	}
	for _, key := range query["f"] {
		if key != "" {
			s.Pills = append(s.Pills, key)
		}
	}
	if wp := query.Get("wp"); wp != "" {
		if err := json.Unmarshal([]byte(wp), &s.Params); err != nil {
			return QueryState{}, &QueryStateError{fmt.Sprintf("wp %q: want a JSON object of strings: %v", wp, err)}
		}
	}
	return s, nil
}

// WriteDiagnostics tells the client what the chart did with the request (X-Dashica-Diagnostics:
// {"ignored":["customer = acme"]} percent-encoded, as the browser's decodeURIComponent reads it); no header when it
// has nothing to say. Header values are bytes the browser reads as Latin-1, so the "≠" of an Exclude pill or an umlaut
// in a value travels percent-encoded.
func WriteDiagnostics(w http.ResponseWriter, d filter.Diagnostics) {
	if len(d.Ignored) == 0 && d.Skipped == "" {
		return
	}
	b, _ := json.Marshal(d) // strings only; cannot fail
	w.Header().Set("X-Dashica-Diagnostics", url.PathEscape(string(b)))
}
