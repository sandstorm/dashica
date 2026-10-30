package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// QueryState is the page's query state as every data handler reads it, from the keys the page keeps in its own URL
// (`?time=1h&sql=status >= 500&wp={"path":"^/api"}`; see docs/2026-10-28-workbench.md §3.7). ParseQueryState reads it
// once per request; the handler resolves its window with ResolveTimeRange and adds SqlClause to the query's WHERE.
type QueryState struct {
	// Time is the time range: a preset as a Go duration (`1h`, `168h`), or `custom` for Range.
	Time string
	// Range is the custom range, `<from> to <to>`, each end a time expression (`2026-10-29 10:00`, `now-6h`).
	Range string
	// Sql is the free SQL filter, '' for none.
	Sql string
	// Params are the values of the page's form widgets by name, bound as ClickHouse parameters (`param_<name>`).
	Params map[string]string
	// preset is Time as a duration; 0 for `custom`.
	preset time.Duration
}

// ParseQueryState reads the query state of `r`: `time`, `range`, `sql` and `wp` (a JSON object of strings). The error
// says what cannot be read: a missing `time`, a `time` that is neither a Go duration nor `custom`, a `wp` that is not
// such an object. An unreadable `range` is ResolveTimeRange's error.
func ParseQueryState(r *http.Request) (QueryState, error) {
	query := r.URL.Query()
	s := QueryState{Time: query.Get("time"), Range: query.Get("range"), Sql: query.Get("sql")}
	if s.Time == "" {
		return QueryState{}, errors.New("time range missing: want `time=<Go duration>` or `time=custom&range=<from> to <to>`")
	}
	if s.Time != "custom" {
		dur, err := time.ParseDuration(s.Time)
		if err != nil || dur <= 0 {
			return QueryState{}, fmt.Errorf("time range %q: neither a Go duration (`1h`) nor `custom`", s.Time)
		}
		s.preset = dur
	}
	if wp := query.Get("wp"); wp != "" {
		if err := json.Unmarshal([]byte(wp), &s.Params); err != nil {
			return QueryState{}, fmt.Errorf("wp %q: want a JSON object of strings: %w", wp, err)
		}
	}
	return s, nil
}
