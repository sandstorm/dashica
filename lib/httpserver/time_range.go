package httpserver

import (
	"fmt"
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
