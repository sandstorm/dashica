package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/sandstorm/dashica/lib/dashboard/filter"
)

// QueryState is the page's query state as every data handler reads it, from the keys the page keeps in its own URL
// (`?time=1h&f=host:eq:a&sql=status >= 500&wp={"path":"^/api"}`; see docs/2026-10-28-workbench.md §3.7). ParseQueryState
// reads it once per request; the handler resolves its window with ResolveTimeRange and adds SqlClause to the query's
// WHERE, the chart the filters it interprets (filter.Apply).
type QueryState struct {
	// Time is the time range: a preset as a Go duration (`1h`, `168h`), or `custom` for Range.
	Time string
	// Range is the custom range, `<from> to <to>`, each end a time expression (`2026-10-29 10:00`, `now-6h`).
	Range string
	// Filters are the structured filters, in the order of the URL; each chart interprets them itself.
	Filters []filter.Filter
	// Sql is the free SQL filter, '' for none.
	Sql string
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

// ParseQueryState reads the query state of `r`: `time`, `range`, each `f` (`<id>:<op>:<value>`, the value everything
// after the second colon), `sql` and `wp` (a JSON object of strings). The QueryStateError says what cannot be read: a
// missing `time`, a `time` that is neither a Go duration nor `custom`, an `f` without op or with an op other than
// `eq` / `ne`, a `wp` that is not such an object. An unreadable `range` is ResolveTimeRange's error.
func ParseQueryState(r *http.Request) (QueryState, error) {
	query := r.URL.Query()
	s := QueryState{Time: query.Get("time"), Range: query.Get("range"), Sql: query.Get("sql")}
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
	for _, f := range query["f"] {
		parts := strings.SplitN(f, ":", 3)
		if len(parts) != 3 || parts[0] == "" || (parts[1] != "eq" && parts[1] != "ne") {
			return QueryState{}, &QueryStateError{fmt.Sprintf("filter %q: want `<id>:eq:<value>` or `<id>:ne:<value>`", f)}
		}
		s.Filters = append(s.Filters, filter.Filter{ID: parts[0], Op: parts[1], Value: parts[2]})
	}
	if wp := query.Get("wp"); wp != "" {
		if err := json.Unmarshal([]byte(wp), &s.Params); err != nil {
			return QueryState{}, &QueryStateError{fmt.Sprintf("wp %q: want a JSON object of strings: %v", wp, err)}
		}
	}
	return s, nil
}

// WriteDiagnostics tells the client what the chart did with the request (X-Dashica-Diagnostics:
// {"ignored":["host"]}); no header when it has nothing to say.
func WriteDiagnostics(w http.ResponseWriter, d filter.Diagnostics) {
	if len(d.Ignored) == 0 && d.Skipped == "" {
		return
	}
	b, _ := json.Marshal(d) // strings only; cannot fail
	w.Header().Set("X-Dashica-Diagnostics", string(b))
}
