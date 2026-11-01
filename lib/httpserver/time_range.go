package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/httpserver/querying"
)

// relativeTimeExpr is `now`, or `now` and an offset: `now-6h`, `now+1d` (units s m h d w).
var relativeTimeExpr = regexp.MustCompile(`^now(?:([+-])(\d+)([smhdw]))?$`)

// parseTimeExpr reads one end of a custom time range, as the time picker sends it (see
// docs/2026-10-28-workbench.md §3.7): an absolute time `2026-10-29 10:00` in the server's time zone, or a time
// relative to `now` (`now-6h`). Days and weeks are calendar days, so `now-1d` is the same time yesterday.
func parseTimeExpr(text string, now time.Time) (time.Time, error) {
	text = strings.TrimSpace(text)
	if m := relativeTimeExpr.FindStringSubmatch(text); m != nil {
		if m[1] == "" {
			return now, nil
		}
		n, err := strconv.Atoi(m[2])
		if err != nil {
			return time.Time{}, fmt.Errorf("time %q: %w", text, err)
		}
		if m[1] == "-" {
			n = -n
		}
		switch m[3] {
		case "s":
			return now.Add(time.Duration(n) * time.Second), nil
		case "m":
			return now.Add(time.Duration(n) * time.Minute), nil
		case "h":
			return now.Add(time.Duration(n) * time.Hour), nil
		case "d":
			return now.AddDate(0, 0, n), nil
		default: // "w"
			return now.AddDate(0, 0, 7*n), nil
		}
	}
	t, err := time.ParseInLocation("2006-01-02 15:04", text, time.Local)
	if err != nil {
		return time.Time{}, fmt.Errorf("time %q: neither `now-…` nor `2006-01-02 15:04`", text)
	}
	return t, nil
}

// ResolveTimeRange is the window the time range stands for at `now`, in milliseconds: a preset (a Go duration) ends at
// now; a custom range is "<from> to <to>", each end a time expression (parseTimeExpr). The error says what cannot be
// read, as the time picker and the charts show it. Every handler resolves here, with the server's clock, so the charts
// of a page query the same numbers.
func (s QueryState) ResolveTimeRange(now time.Time) (*querying.TimeRange, error) {
	if s.Time != "custom" {
		return newTimeRange(now.Add(-s.preset), now), nil
	}
	parts := strings.Split(s.Range, " to ")
	if len(parts) != 2 {
		return nil, fmt.Errorf("custom range %q: want `<from> to <to>`", s.Range)
	}
	from, err := parseTimeExpr(parts[0], now)
	if err != nil {
		return nil, err
	}
	to, err := parseTimeExpr(parts[1], now)
	if err != nil {
		return nil, err
	}
	if !from.Before(to) {
		return nil, fmt.Errorf("custom range %q: from is not before to", s.Range)
	}
	return newTimeRange(from, to), nil
}

func newTimeRange(from, to time.Time) *querying.TimeRange {
	fromMs, toMs := from.UnixMilli(), to.UnixMilli()
	return &querying.TimeRange{From: &fromMs, To: &toMs}
}

// SqlClause is the condition the query state adds to a query's WHERE: the window `timeRange` (TimeClause) and each
// SQL chip in its own parentheses, `timestamp >= 1761724800 AND timestamp <= 1761746400 AND (status >= 500) AND (a OR b)`.
// SQL chips while `filters` takes none (filters.sqlEnabled off) are ErrSqlNotEnabled, a 400 before any query.
func (s QueryState) SqlClause(timeRange *querying.TimeRange, filters config.FiltersConfig) (string, error) {
	if len(s.Sql) > 0 && !filters.SqlEnabled {
		return "", ErrSqlNotEnabled
	}
	clause := TimeClause(timeRange)
	for _, chip := range s.Sql {
		clause += " AND (" + chip + ")"
	}
	return clause, nil
}

// TimeClause is the condition of the window `timeRange` alone, `timestamp >= 1761724800 AND timestamp <= 1761746400`,
// as the alert charts add it. It references the `timestamp` column, so it assumes the query selects from a single
// base table that has one.
func TimeClause(timeRange *querying.TimeRange) string {
	return fmt.Sprintf("timestamp >= %d AND timestamp <= %d", *timeRange.From/1000, *timeRange.To/1000)
}

// WriteResolvedTimeRange tells the charts the window their query covers (X-Dashica-Resolved-Time-Range), so that they
// show all of it, also where there is no data at its start or end.
func WriteResolvedTimeRange(w http.ResponseWriter, timeRange *querying.TimeRange) {
	b, _ := json.Marshal(timeRange) // two numbers; cannot fail
	w.Header().Add("X-Dashica-Resolved-Time-Range", string(b))
}

// TimeRangeHandler serves the window of the request's query state (ParseQueryState, as every data handler reads it;
// DefaultTimeRange without `time`: it has no page) at now, as `{"from": <ms>, "to": <ms>}`, or 400 with what cannot be
// read. The time picker asks it, always with `time`, before it applies a range, and for the window it shifts or zooms out. It applies no SQL chip, so it takes one also while
// filters.sqlEnabled is off.
type TimeRangeHandler struct{}

func (h TimeRangeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	state, err := ParseQueryState(r, DefaultTimeRange)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	timeRange, err := state.ResolveTimeRange(time.Now())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(timeRange); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
