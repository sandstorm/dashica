package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
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

// ResolveTimeRange is the window the time range stands for at `now`: a preset (a Go duration) ends at now; a custom
// range is "<from> to <to>", each end a time expression (parseTimeExpr). The error says what cannot be read, as the
// time picker shows it.
func (f *DashboardFilters) ResolveTimeRange(now time.Time) (from, to time.Time, err error) {
	if f.TimeRange != "custom" {
		dur, err := time.ParseDuration(f.TimeRange)
		if err != nil || dur <= 0 {
			return time.Time{}, time.Time{}, fmt.Errorf("time range %q: neither a Go duration (`1h`) nor `custom`", f.TimeRange)
		}
		return now.Add(-dur), now, nil
	}
	parts := strings.Split(f.CustomTimeRange, " to ")
	if len(parts) != 2 {
		return time.Time{}, time.Time{}, fmt.Errorf("custom range %q: want `<from> to <to>`", f.CustomTimeRange)
	}
	if from, err = parseTimeExpr(parts[0], now); err != nil {
		return time.Time{}, time.Time{}, err
	}
	if to, err = parseTimeExpr(parts[1], now); err != nil {
		return time.Time{}, time.Time{}, err
	}
	if !from.Before(to) {
		return time.Time{}, time.Time{}, fmt.Errorf("custom range %q: from is not before to", f.CustomTimeRange)
	}
	return from, to, nil
}

// TimeRangeHandler serves the window of the request's `filters` (as every data handler reads them) at now, as
// `{"from": <ms>, "to": <ms>}`, or 400 with what cannot be read. The time picker asks it before it applies a range,
// and for the window it shifts or zooms out.
func TimeRangeHandler(w http.ResponseWriter, r *http.Request) {
	var filters DashboardFilters
	if err := json.Unmarshal([]byte(r.URL.Query().Get("filters")), &filters); err != nil {
		http.Error(w, fmt.Sprintf("filters: %v", err), http.StatusBadRequest)
		return
	}
	from, to, err := filters.ResolveTimeRange(time.Now())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]int64{"from": from.UnixMilli(), "to": to.UnixMilli()}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
